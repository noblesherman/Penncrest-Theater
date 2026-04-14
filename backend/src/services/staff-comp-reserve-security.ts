import { StaffCompReserveAttemptOutcome, StaffCompReserveLockoutKeyType } from '@prisma/client';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';

export type StaffCompReserveGuardFailure = {
	reason: string;
	message: string;
	retryAfterSeconds: number;
	lockoutApplied: boolean;
};

type LockoutKey = {
	keyType: StaffCompReserveLockoutKeyType;
	keyValue: string;
};

const LOCKOUT_ELIGIBLE_OUTCOMES: StaffCompReserveAttemptOutcome[] = ['FAILED', 'BLOCKED'];

function lockoutDurationMs(): number {
	return Math.max(1, env.STAFF_COMP_RESERVE_LOCKOUT_MINUTES) * 60_000;
}

function lockoutUntilFrom(now: Date): Date {
	return new Date(now.getTime() + lockoutDurationMs());
}

function retryAfterSecondsFrom(now: Date, lockedUntil: Date): number {
	return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
}

function dedupeLockoutKeys(keys: LockoutKey[]): LockoutKey[] {
	const seen = new Set<string>();
	const deduped: LockoutKey[] = [];

	for (const key of keys) {
		if (!key.keyValue) continue;
		const hash = `${key.keyType}:${key.keyValue}`;
		if (seen.has(hash)) continue;
		seen.add(hash);
		deduped.push(key);
	}

	return deduped;
}

async function upsertLockouts(params: {
	now: Date;
	keys: LockoutKey[];
	reason: string;
}): Promise<Date | null> {
	const uniqueKeys = dedupeLockoutKeys(params.keys);
	if (uniqueKeys.length === 0) {
		return null;
	}

	const lockedUntil = lockoutUntilFrom(params.now);

	await Promise.all(
		uniqueKeys.map((key) =>
			prisma.staffCompReserveLockout.upsert({
				where: {
					keyType_keyValue: {
						keyType: key.keyType,
						keyValue: key.keyValue
					}
				},
				create: {
					keyType: key.keyType,
					keyValue: key.keyValue,
					lockedUntil,
					reason: params.reason
				},
				update: {
					lockedUntil,
					reason: params.reason
				}
			})
		)
	);

	return lockedUntil;
}

export async function evaluateStaffCompReserveGuards(params: {
	now?: Date;
	clientIp: string;
	customerEmail: string;
	promoCodeHash: string;
}): Promise<StaffCompReserveGuardFailure | null> {
	const now = params.now || new Date();
	const ip = params.clientIp;
	const customerEmail = params.customerEmail;
	const promoCodeHash = params.promoCodeHash;

	const activeLockouts = await prisma.staffCompReserveLockout.findMany({
		where: {
			lockedUntil: { gt: now },
			OR: [
				{ keyType: 'IP', keyValue: ip },
				{ keyType: 'EMAIL', keyValue: customerEmail },
				{ keyType: 'PROMO_CODE', keyValue: promoCodeHash }
			]
		},
		select: {
			lockedUntil: true
		},
		orderBy: {
			lockedUntil: 'desc'
		}
	});

	if (activeLockouts.length > 0) {
		const lockedUntil = activeLockouts[0].lockedUntil;
		return {
			reason: 'LOCKED',
			message: `Staff comp reservations are temporarily locked. Try again in ${retryAfterSecondsFrom(now, lockedUntil)} seconds.`,
			retryAfterSeconds: retryAfterSecondsFrom(now, lockedUntil),
			lockoutApplied: false
		};
	}

	const [ipAttemptCount, emailAttemptCount, codeAttemptCount] = await Promise.all([
		prisma.staffCompReserveAttempt.count({
			where: {
				clientIp: ip,
				createdAt: {
					gte: new Date(now.getTime() - env.STAFF_COMP_RESERVE_IP_WINDOW_SECONDS * 1000)
				}
			}
		}),
		prisma.staffCompReserveAttempt.count({
			where: {
				customerEmail,
				createdAt: {
					gte: new Date(now.getTime() - env.STAFF_COMP_RESERVE_EMAIL_WINDOW_SECONDS * 1000)
				}
			}
		}),
		prisma.staffCompReserveAttempt.count({
			where: {
				promoCodeHash,
				createdAt: {
					gte: new Date(now.getTime() - env.STAFF_COMP_RESERVE_CODE_WINDOW_SECONDS * 1000)
				}
			}
		})
	]);

	const lockoutKeys: LockoutKey[] = [];
	const reasonCodes: string[] = [];

	if (ipAttemptCount >= env.STAFF_COMP_RESERVE_IP_MAX_ATTEMPTS) {
		lockoutKeys.push({ keyType: 'IP', keyValue: ip });
		reasonCodes.push('THROTTLED_IP');
	}

	if (emailAttemptCount >= env.STAFF_COMP_RESERVE_EMAIL_MAX_ATTEMPTS) {
		lockoutKeys.push({ keyType: 'EMAIL', keyValue: customerEmail });
		reasonCodes.push('THROTTLED_EMAIL');
	}

	if (codeAttemptCount >= env.STAFF_COMP_RESERVE_CODE_MAX_ATTEMPTS) {
		lockoutKeys.push({ keyType: 'PROMO_CODE', keyValue: promoCodeHash });
		reasonCodes.push('THROTTLED_PROMO_CODE');
	}

	if (lockoutKeys.length === 0) {
		return null;
	}

	const lockedUntil = await upsertLockouts({
		now,
		keys: lockoutKeys,
		reason: 'THROTTLED'
	});

	const retryAfterSeconds = lockedUntil ? retryAfterSecondsFrom(now, lockedUntil) : Math.max(1, env.STAFF_COMP_RESERVE_LOCKOUT_MINUTES * 60);

	return {
		reason: reasonCodes.join(','),
		message: `Too many staff comp reservation attempts. Try again in ${retryAfterSeconds} seconds.`,
		retryAfterSeconds,
		lockoutApplied: true
	};
}

async function maybeApplyFailureLockouts(params: {
	now: Date;
	clientIp: string;
	customerEmail: string;
	promoCodeHash: string;
}): Promise<boolean> {
	const failureWindowStartedAt = new Date(params.now.getTime() - env.STAFF_COMP_RESERVE_FAILURE_WINDOW_SECONDS * 1000);
	const [ipFailureCount, emailFailureCount, codeFailureCount] = await Promise.all([
		prisma.staffCompReserveAttempt.count({
			where: {
				clientIp: params.clientIp,
				createdAt: { gte: failureWindowStartedAt },
				outcome: {
					in: LOCKOUT_ELIGIBLE_OUTCOMES
				}
			}
		}),
		prisma.staffCompReserveAttempt.count({
			where: {
				customerEmail: params.customerEmail,
				createdAt: { gte: failureWindowStartedAt },
				outcome: {
					in: LOCKOUT_ELIGIBLE_OUTCOMES
				}
			}
		}),
		prisma.staffCompReserveAttempt.count({
			where: {
				promoCodeHash: params.promoCodeHash,
				createdAt: { gte: failureWindowStartedAt },
				outcome: {
					in: LOCKOUT_ELIGIBLE_OUTCOMES
				}
			}
		})
	]);

	const lockoutThreshold = env.STAFF_COMP_RESERVE_FAILURE_LOCK_THRESHOLD;
	const keys: LockoutKey[] = [];

	if (ipFailureCount >= lockoutThreshold) {
		keys.push({ keyType: 'IP', keyValue: params.clientIp });
	}

	if (emailFailureCount >= lockoutThreshold) {
		keys.push({ keyType: 'EMAIL', keyValue: params.customerEmail });
	}

	if (codeFailureCount >= lockoutThreshold) {
		keys.push({ keyType: 'PROMO_CODE', keyValue: params.promoCodeHash });
	}

	if (keys.length === 0) {
		return false;
	}

	await upsertLockouts({
		now: params.now,
		keys,
		reason: 'FAILURE_THRESHOLD'
	});

	return true;
}

export async function recordStaffCompReserveAttempt(params: {
	now?: Date;
	requestedPerformanceId?: string;
	clientIp: string;
	customerEmail: string;
	promoCodeHash: string;
	outcome: StaffCompReserveAttemptOutcome;
	failureReason?: string;
	orderId?: string;
	ticketId?: string;
	lockoutApplied?: boolean;
}): Promise<{ lockoutApplied: boolean }> {
	const now = params.now || new Date();
	const attempt = await prisma.staffCompReserveAttempt.create({
		data: {
			requestedPerformanceId: params.requestedPerformanceId,
			clientIp: params.clientIp,
			customerEmail: params.customerEmail,
			promoCodeHash: params.promoCodeHash,
			outcome: params.outcome,
			failureReason: params.failureReason,
			orderId: params.orderId,
			ticketId: params.ticketId,
			lockoutApplied: Boolean(params.lockoutApplied)
		},
		select: {
			id: true
		}
	});

	if (params.outcome === 'SUCCEEDED' || params.lockoutApplied) {
		return { lockoutApplied: Boolean(params.lockoutApplied) };
	}

	const lockoutApplied = await maybeApplyFailureLockouts({
		now,
		clientIp: params.clientIp,
		customerEmail: params.customerEmail,
		promoCodeHash: params.promoCodeHash
	});

	if (!lockoutApplied) {
		return { lockoutApplied: false };
	}

	await prisma.staffCompReserveAttempt.update({
		where: {
			id: attempt.id
		},
		data: {
			lockoutApplied: true
		}
	});

	return { lockoutApplied: true };
}

/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/cashier-checkout-logger.ts`
- What this is: Backend shared observability helper.
- What it does: Emits structured cashier checkout diagnostics that PM2 can capture.
- Connections: Used by admin in-person checkout routes and order assignment.
- Main content type: Logging helpers only.
- Safe edits here: Additive diagnostic fields and message wording.
- Be careful with: Logging customer PII or payment secrets.
*/

import type { FastifyBaseLogger } from 'fastify';

type CashierCheckoutLogLevel = 'info' | 'warn' | 'error';

type CashierCheckoutLogFields = Record<string, unknown>;

function hasLoggerMethod(
  logger: FastifyBaseLogger | undefined,
  level: CashierCheckoutLogLevel
): logger is FastifyBaseLogger {
  return typeof logger?.[level] === 'function';
}

function consoleMethodForLevel(level: CashierCheckoutLogLevel): 'info' | 'warn' | 'error' {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warn';
  return 'info';
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return sanitizeCashierCheckoutError(value);
  }
  return value;
}

export function sanitizeCashierCheckoutError(err: unknown): {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  status?: number;
} {
  if (err instanceof Error) {
    const record = err as Error & { code?: unknown; statusCode?: unknown; status?: unknown };
    return {
      name: err.name,
      message: err.message,
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(typeof record.statusCode === 'number' ? { statusCode: record.statusCode } : {}),
      ...(typeof record.status === 'number' ? { status: record.status } : {})
    };
  }

  return {
    name: typeof err,
    message: typeof err === 'string' ? err : 'Non-Error thrown'
  };
}

export function logCashierCheckout(
  logger: FastifyBaseLogger | undefined,
  level: CashierCheckoutLogLevel,
  message: string,
  fields: CashierCheckoutLogFields
): void {
  const payload = {
    event: 'admin_in_person_finalize',
    routeName: 'POST /api/admin/orders/in-person/finalize',
    ...fields
  };
  const logMessage = `cashier checkout ${message}`;

  if (hasLoggerMethod(logger, level)) {
    try {
      logger[level](payload, logMessage);
    } catch {
      // Console fallback below is the operationally important sink for PM2.
    }
  }

  const consoleMethod = consoleMethodForLevel(level);
  try {
    console[consoleMethod](
      JSON.stringify(
        {
          level,
          message: logMessage,
          ...payload
        },
        jsonReplacer
      )
    );
  } catch {
    console[consoleMethod](logMessage);
  }
}

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { hasAdminRole } from '../lib/admin-users.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';

const dashboardQuerySchema = z.object({
  range: z.enum(['month', 'today', 'rolling30']).default('month')
});

type DashboardRange = z.infer<typeof dashboardQuerySchema>['range'];

function getRangeStart(range: DashboardRange, now: Date): Date {
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
    return start;
  }

  if (range === 'rolling30') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function toPerformanceTitle(performance: {
  title: string | null;
  show: { title: string };
}): string {
  return performance.title || performance.show.title;
}

function summarizeFormStats(
  forms: Array<{
    isOpen: boolean;
    deadlineAt: Date;
    _count: { submissions: number };
  }>,
  now: Date
) {
  let openCount = 0;
  let closedCount = 0;
  let responseCount = 0;

  forms.forEach((form) => {
    const isOpen = form.isOpen && form.deadlineAt > now;
    if (isOpen) {
      openCount += 1;
    } else {
      closedCount += 1;
    }
    responseCount += form._count.submissions;
  });

  return {
    openCount,
    closedCount,
    responseCount
  };
}

function buildQuickLinks(isAdminOrHigher: boolean) {
  const base = {
    orders: '/admin/orders',
    scanner: '/admin/scanner'
  };

  if (!isAdminOrHigher) {
    return base;
  }

  return {
    ...base,
    trips: '/admin/trips',
    fundraise: '/admin/fundraise',
    forms: '/admin/forms',
    audit: '/admin/audit'
  };
}

async function getDonationSucceededCentsInRange(params: {
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<number | null> {
  try {
    const created = {
      gte: Math.floor(params.rangeStart.getTime() / 1000),
      lte: Math.floor(params.rangeEnd.getTime() / 1000)
    };

    let total = 0;
    let startingAfter: string | undefined;

    for (let pageIndex = 0; pageIndex < 12; pageIndex += 1) {
      const page = await stripe.paymentIntents.list({
        limit: 100,
        created,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });

      page.data.forEach((intent) => {
        if (intent.metadata?.source !== 'fundraising_donation') return;
        if (intent.status !== 'succeeded') return;
        total += intent.amount || 0;
      });

      if (!page.has_more || page.data.length === 0) {
        break;
      }

      startingAfter = page.data[page.data.length - 1]?.id;
      if (!startingAfter) {
        break;
      }
    }

    return total;
  } catch {
    return null;
  }
}

export const adminDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/dashboard', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = dashboardQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const now = new Date();
      const rangeStart = getRangeStart(parsed.data.range, now);
      const rangeEnd = now;
      const isAdminOrHigher = Boolean(request.adminUser && hasAdminRole(request.adminUser.role, 'ADMIN'));

      const [
        paidRevenue,
        paidOrderCount,
        ticketsIssuedCount,
        checkInsCount,
        upcomingPerformances,
        recentOrders,
        activeScannerSessions,
        latestScan
      ] = await Promise.all([
        prisma.order.aggregate({
          where: {
            status: 'PAID',
            performance: { isArchived: false },
            createdAt: {
              gte: rangeStart,
              lte: rangeEnd
            }
          },
          _sum: {
            amountTotal: true
          }
        }),
        prisma.order.count({
          where: {
            status: 'PAID',
            performance: { isArchived: false },
            createdAt: {
              gte: rangeStart,
              lte: rangeEnd
            }
          }
        }),
        prisma.ticket.count({
          where: {
            performance: { isArchived: false },
            status: 'ISSUED',
            createdAt: {
              gte: rangeStart,
              lte: rangeEnd
            }
          }
        }),
        prisma.ticket.count({
          where: {
            performance: { isArchived: false },
            checkedInAt: {
              gte: rangeStart,
              lte: rangeEnd
            }
          }
        }),
        prisma.performance.findMany({
          where: {
            isArchived: false,
            startsAt: {
              gte: now
            }
          },
          orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
          take: 5,
          select: {
            id: true,
            title: true,
            startsAt: true,
            venue: true,
            show: {
              select: {
                title: true
              }
            }
          }
        }),
        prisma.order.findMany({
          where: {
            performance: {
              isArchived: false
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 8,
          select: {
            id: true,
            customerName: true,
            email: true,
            amountTotal: true,
            currency: true,
            status: true,
            createdAt: true,
            performance: {
              select: {
                id: true,
                title: true,
                startsAt: true,
                show: {
                  select: {
                    title: true
                  }
                }
              }
            }
          }
        }),
        prisma.scannerSession.count({
          where: {
            active: true,
            endedAt: null,
            performance: {
              isArchived: false
            }
          }
        }),
        prisma.checkInScanAttempt.findFirst({
          where: {
            performance: {
              isArchived: false
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          select: {
            createdAt: true
          }
        })
      ]);

      const response: {
        generatedAt: string;
        range: DashboardRange;
        core: {
          paidRevenueCents: number;
          paidOrderCount: number;
          ticketsIssuedCount: number;
          checkInsCount: number;
        };
        operations: {
          upcomingPerformances: Array<{
            id: string;
            title: string;
            startsAt: string;
            venue: string;
          }>;
          recentOrders: Array<{
            id: string;
            customerName: string;
            email: string;
            amountTotalCents: number;
            currency: string;
            status: string;
            createdAt: string;
            performance: {
              id: string;
              title: string;
              startsAt: string;
            };
          }>;
          scanner: {
            activeSessions: number;
            latestScanAt: string | null;
          };
        };
        quickLinks: ReturnType<typeof buildQuickLinks>;
        adminModules?: {
          trips: {
            activeTripCount: number;
            enrollmentCount: number;
            collectedCents: number;
            remainingCents: number;
            nextDueAt: string | null;
          };
          fundraise: {
            activeEventCount: number;
            seatsSold: number;
            seatsTotal: number;
            donationSucceededCents: number | null;
          };
          forms: {
            openCount: number;
            closedCount: number;
            responseCount: number;
            programBio: {
              openCount: number;
              closedCount: number;
              responseCount: number;
            };
            seniorSendoff: {
              openCount: number;
              closedCount: number;
              responseCount: number;
            };
          };
          system: {
            recentAudit: Array<{
              id: string;
              actor: string;
              action: string;
              entityType: string;
              entityId: string;
              createdAt: string;
            }>;
          };
        };
      } = {
        generatedAt: now.toISOString(),
        range: parsed.data.range,
        core: {
          paidRevenueCents: paidRevenue._sum.amountTotal || 0,
          paidOrderCount,
          ticketsIssuedCount,
          checkInsCount
        },
        operations: {
          upcomingPerformances: upcomingPerformances.map((performance) => ({
            id: performance.id,
            title: toPerformanceTitle(performance),
            startsAt: performance.startsAt.toISOString(),
            venue: performance.venue
          })),
          recentOrders: recentOrders.map((order) => ({
            id: order.id,
            customerName: order.customerName,
            email: order.email,
            amountTotalCents: order.amountTotal,
            currency: order.currency,
            status: order.status,
            createdAt: order.createdAt.toISOString(),
            performance: {
              id: order.performance.id,
              title: toPerformanceTitle(order.performance),
              startsAt: order.performance.startsAt.toISOString()
            }
          })),
          scanner: {
            activeSessions: activeScannerSessions,
            latestScanAt: latestScan?.createdAt.toISOString() || null
          }
        },
        quickLinks: buildQuickLinks(isAdminOrHigher)
      };

      if (isAdminOrHigher) {
        const [
          activeTripCount,
          tripRows,
          tripDueDates,
          activeFundraiseEventCount,
          fundraiseSeatsSold,
          fundraiseSeatsTotal,
          donationSucceededCents,
          programBioForms,
          seniorSendoffForms,
          recentAudit
        ] = await Promise.all([
          prisma.trip.count({
            where: {
              isArchived: false
            }
          }),
          prisma.tripEnrollment.findMany({
            where: {
              trip: {
                isArchived: false
              }
            },
            select: {
              targetAmountCents: true,
              dueAtOverride: true,
              trip: {
                select: {
                  dueAt: true
                }
              },
              payments: {
                where: {
                  status: 'SUCCEEDED'
                },
                select: {
                  amountCents: true
                }
              }
            }
          }),
          prisma.trip.findMany({
            where: {
              isArchived: false
            },
            select: {
              dueAt: true
            }
          }),
          prisma.performance.count({
            where: {
              isArchived: false,
              isFundraiser: true,
              startsAt: {
                gte: now
              }
            }
          }),
          prisma.seat.count({
            where: {
              status: 'SOLD',
              performance: {
                isArchived: false,
                isFundraiser: true,
                startsAt: {
                  gte: now
                }
              }
            }
          }),
          prisma.seat.count({
            where: {
              performance: {
                isArchived: false,
                isFundraiser: true,
                startsAt: {
                  gte: now
                }
              }
            }
          }),
          getDonationSucceededCentsInRange({
            rangeStart,
            rangeEnd
          }),
          prisma.programBioForm.findMany({
            select: {
              isOpen: true,
              deadlineAt: true,
              _count: {
                select: {
                  submissions: true
                }
              }
            }
          }),
          prisma.seniorSendoffForm.findMany({
            select: {
              isOpen: true,
              deadlineAt: true,
              _count: {
                select: {
                  submissions: true
                }
              }
            }
          }),
          prisma.auditLog.findMany({
            orderBy: {
              createdAt: 'desc'
            },
            take: 6,
            select: {
              id: true,
              actor: true,
              action: true,
              entityType: true,
              entityId: true,
              createdAt: true
            }
          })
        ]);

        const enrollmentCount = tripRows.length;
        let collectedCents = 0;
        let remainingCents = 0;
        const dueCandidates: Date[] = [];

        tripRows.forEach((enrollment) => {
          const paidForEnrollment = enrollment.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
          const effectiveDueAt = enrollment.dueAtOverride || enrollment.trip.dueAt;
          collectedCents += paidForEnrollment;
          remainingCents += Math.max(enrollment.targetAmountCents - paidForEnrollment, 0);
          dueCandidates.push(effectiveDueAt);
        });

        tripDueDates.forEach((trip) => {
          dueCandidates.push(trip.dueAt);
        });

        const nextDueCandidate = dueCandidates
          .filter((date) => date >= now)
          .sort((a, b) => a.getTime() - b.getTime())[0];

        const programBio = summarizeFormStats(programBioForms, now);
        const seniorSendoff = summarizeFormStats(seniorSendoffForms, now);

        response.adminModules = {
          trips: {
            activeTripCount,
            enrollmentCount,
            collectedCents,
            remainingCents,
            nextDueAt: nextDueCandidate ? nextDueCandidate.toISOString() : null
          },
          fundraise: {
            activeEventCount: activeFundraiseEventCount,
            seatsSold: fundraiseSeatsSold,
            seatsTotal: fundraiseSeatsTotal,
            donationSucceededCents
          },
          forms: {
            openCount: programBio.openCount + seniorSendoff.openCount,
            closedCount: programBio.closedCount + seniorSendoff.closedCount,
            responseCount: programBio.responseCount + seniorSendoff.responseCount,
            programBio,
            seniorSendoff
          },
          system: {
            recentAudit: recentAudit.map((entry) => ({
              id: entry.id,
              actor: entry.actor,
              action: entry.action,
              entityType: entry.entityType,
              entityId: entry.entityId,
              createdAt: entry.createdAt.toISOString()
            }))
          }
        };
      }

      reply.send(response);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch dashboard metrics');
    }
  });
};

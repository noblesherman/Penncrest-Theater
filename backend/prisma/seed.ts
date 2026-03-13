import '../src/lib/load-env.js';
import { PrismaClient, SeatStatus } from '@prisma/client';
import { getPenncrestSeatTemplate } from '../src/lib/penncrest-seating.js';
import { env } from '../src/lib/env.js';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function seed() {
  await prisma.teacherCompPromoCode.deleteMany();
  await prisma.staffCompRedemption.deleteMany();
  await prisma.staffRedeemCode.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.orderSeat.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.seatHold.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.holdSession.deleteMany();
  await prisma.pricingTier.deleteMany();
  await prisma.performance.deleteMany();
  await prisma.castMember.deleteMany();
  await prisma.show.deleteMany();

  await prisma.adminUser.create({
    data: {
      username: env.ADMIN_USERNAME.trim().toLowerCase(),
      name: 'Central Admin',
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'SUPER_ADMIN'
    }
  });

  const show = await prisma.show.create({
    data: {
      title: 'Little Shop of Horrors',
      description: 'A dark comedy musical about a florist shop and an unusual plant.',
      posterUrl: 'https://picsum.photos/seed/littleshop/800/1200',
      type: 'Musical',
      year: new Date().getFullYear(),
      accentColor: '#10B981'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      title: show.title,
      startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      salesCutoffAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7 - 1000 * 60 * 60 * 3),
      staffTicketLimit: 2,
      staffCompsEnabled: true,
      staffCompLimitPerUser: 1,
      familyFreeTicketEnabled: true,
      venue: 'Penncrest High School Auditorium',
      notes: 'Doors open 30 minutes before showtime.'
    }
  });

  await prisma.pricingTier.createMany({
    data: [
      { performanceId: performance.id, name: 'Adult', priceCents: 1800 },
      { performanceId: performance.id, name: 'Student', priceCents: 1200 }
    ]
  });

  await prisma.castMember.createMany({
    data: [
      {
        showId: show.id,
        name: 'Alex Rivera',
        role: 'Seymour',
        position: 0
      },
      {
        showId: show.id,
        name: 'Jordan Kim',
        role: 'Audrey',
        position: 1
      },
      {
        showId: show.id,
        name: 'Taylor Brooks',
        role: 'Mr. Mushnik',
        position: 2
      }
    ]
  });

  const seats = [] as Array<{
    performanceId: string;
    row: string;
    number: number;
    sectionName: string;
    x: number;
    y: number;
    price: number;
    isAccessible: boolean;
    status: SeatStatus;
    isCompanion: boolean;
  }>;
  getPenncrestSeatTemplate().forEach((seat) => {
    seats.push({
      performanceId: performance.id,
      row: seat.row,
      number: seat.number,
      sectionName: seat.sectionName,
      x: seat.x,
      y: seat.y,
      price: 1800,
      isAccessible: seat.isAccessible,
      isCompanion: false,
      status: 'AVAILABLE'
    });
  });

  await prisma.seat.createMany({ data: seats });

  console.log('Seeded super admin, show, performance, tiers, and seats.');
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

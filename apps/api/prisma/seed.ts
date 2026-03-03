import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@penncresttheater.org' },
    update: {},
    create: {
      email: 'admin@penncresttheater.org',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN'
    }
  });

  const seatMap = await prisma.seatMapVersion.create({
    data: {
      name: 'Main Auditorium',
      sections: { create: [{ name: 'Orchestra', orderIndex: 0 }] }
    },
    include: { sections: true }
  });

  const section = seatMap.sections[0];
  await prisma.seat.createMany({
    data: Array.from({ length: 10 }).flatMap((_r, rowIdx) =>
      Array.from({ length: 10 }).map((_s, seatIdx) => ({
        seatMapVersionId: seatMap.id,
        sectionId: section.id,
        rowLabel: String.fromCharCode(65 + rowIdx),
        seatNumber: seatIdx + 1,
        seatLabel: `${String.fromCharCode(65 + rowIdx)}-${seatIdx + 1}`,
        orderIndex: rowIdx * 10 + seatIdx,
        flagsJson: {}
      }))
    )
  });

  const seats = await prisma.seat.findMany({ where: { seatMapVersionId: seatMap.id } });

  const show = await prisma.show.create({
    data: {
      title: 'Phantom of the Opera',
      slug: 'phantom',
      description: 'A haunting musical',
      runtimeMinutes: 160,
      posterUrl: 'https://example.com/poster.jpg'
    }
  });

  const performance = await prisma.performance.create({
    data: {
      showId: show.id,
      startsAt: addDays(new Date(), 7),
      doorsAt: addDays(new Date(), 7),
      status: 'ON_SALE',
      seatMapVersionId: seatMap.id,
      onSaleAt: addDays(new Date(), -1),
      offSaleAt: addDays(new Date(), 6)
    }
  });

  await prisma.performanceSeatState.createMany({
    data: seats.map((seat) => ({
      performanceId: performance.id,
      seatId: seat.id,
      state: 'AVAILABLE'
    }))
  });

  await prisma.tier.createMany({
    data: [
      { performanceId: performance.id, name: 'Adult', priceCents: 2000, orderIndex: 0, active: true },
      { performanceId: performance.id, name: 'Student', priceCents: 1500, orderIndex: 1, active: true }
    ]
  });

  console.log('Seeded admin, show, performance, seats');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

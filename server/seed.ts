import db from './db';
import { v4 as uuidv4 } from 'uuid';

console.log('Seeding database...');

// Clear existing data
db.exec('DELETE FROM tickets');
db.exec('DELETE FROM orders');
db.exec('DELETE FROM seat_holds');
db.exec('DELETE FROM seats');
db.exec('DELETE FROM sections');
db.exec('DELETE FROM performances');
db.exec('DELETE FROM shows');

// 1. Create Shows
const shows = [
  {
    id: uuidv4(),
    title: 'Little Shop of Horrors',
    description: 'A floral shop worker discovers a sentient carnivorous plant that feeds on human blood.',
    posterUrl: 'https://static.wikia.nocookie.net/horrormovies/images/5/5a/Little_Shop_of_Horrors.jpg/revision/latest?cb=20221011205523',
    type: 'Musical',
    year: 2024,
    accentColor: '#10B981' // Green
  },
  {
    id: uuidv4(),
    title: 'Cinderella',
    description: 'The classic fairy tale of a young woman mistreated by her stepmother and stepsisters.',
    posterUrl: 'https://picsum.photos/seed/cinderella/400/6https://m.media-amazon.com/images/I/81PoubG38hL._UF1000,1000_QL80_.jpg00',
    type: 'Musical',
    year: 2023,
    accentColor: '#3B82F6' // Blue
  },
  {
    id: uuidv4(),
    title: 'The Phantom of the Opera',
    description: 'A disfigured musical genius haunts the Paris Opera House.',
    posterUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSFDh5TRueYZi8QcFNes_D9cOZNH96j6apoiw&s',
    type: 'Musical',
    year: 2022,
    accentColor: '#EF4444' // Red
  }
];

const insertShow = db.prepare('INSERT INTO shows (id, title, description, posterUrl, type, year, accentColor) VALUES (?, ?, ?, ?, ?, ?, ?)');
shows.forEach(show => insertShow.run(show.id, show.title, show.description, show.posterUrl, show.type, show.year, show.accentColor));

// 2. Create Performances (for the first show)
const performances = [
  { id: uuidv4(), showId: shows[0].id, date: new Date(Date.now() + 86400000 * 7).toISOString() }, // 1 week from now
  { id: uuidv4(), showId: shows[0].id, date: new Date(Date.now() + 86400000 * 8).toISOString() }, // 8 days from now
];

const insertPerformance = db.prepare('INSERT INTO performances (id, showId, date) VALUES (?, ?, ?)');
performances.forEach(perf => insertPerformance.run(perf.id, perf.showId, perf.date));

// 3. Create Sections
const sections = [
  { id: uuidv4(), name: 'Orchestra', price: 2000 }, // $20.00
];

const insertSection = db.prepare('INSERT INTO sections (id, name, price) VALUES (?, ?, ?)');
sections.forEach(sec => insertSection.run(sec.id, sec.name, sec.price));

// 4. Create Seats
// Penncrest chart layout imported from the provided seating spreadsheet.
const insertSeat = db.prepare('INSERT INTO seats (id, sectionId, row, number, x, y, isAccessible) VALUES (?, ?, ?, ?, ?, ?, ?)');

const FULL_CENTER_BLOCK = Array.from({ length: 14 }, (_, i) => 114 - i);
const FRONT_ROW_CENTER_BLOCK = [113, 112, 111, 110, 109, 108, 106, 105, 104, 103, 102, 101];
const BACK_ROW_CENTER_BLOCK = [113, 111, 109, 106, 104, 102];
const SEAT_GRID_STEP = 40;
const ROW_VERTICAL_START = 100;

type RowLayout = {
  row: string;
  leftMaxOdd: number;
  centerSeats: number[];
  rightMaxEven: number;
};

const rowLayouts: RowLayout[] = [
  { row: 'A', leftMaxOdd: 7, centerSeats: FRONT_ROW_CENTER_BLOCK, rightMaxEven: 8 },
  { row: 'B', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'C', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'D', leftMaxOdd: 11, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 12 },
  { row: 'E', leftMaxOdd: 13, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 14 },
  { row: 'F', leftMaxOdd: 13, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 14 },
  { row: 'G', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'H', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'J', leftMaxOdd: 15, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 16 },
  { row: 'K', leftMaxOdd: 17, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 18 },
  { row: 'L', leftMaxOdd: 17, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 18 },
  { row: 'M', leftMaxOdd: 19, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 20 },
  { row: 'N', leftMaxOdd: 19, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 20 },
  { row: 'O', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'P', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'Q', leftMaxOdd: 21, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 22 },
  { row: 'R', leftMaxOdd: 23, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 24 },
  { row: 'S', leftMaxOdd: 23, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 24 },
  { row: 'T', leftMaxOdd: 25, centerSeats: FULL_CENTER_BLOCK, rightMaxEven: 26 },
  { row: 'U', leftMaxOdd: 25, centerSeats: BACK_ROW_CENTER_BLOCK, rightMaxEven: 26 },
  { row: 'V', leftMaxOdd: 25, centerSeats: [], rightMaxEven: 26 },
  { row: 'W', leftMaxOdd: 27, centerSeats: [], rightMaxEven: 28 },
];

const leftColumnForSeat = (seatNumber: number) => 16 - (seatNumber + 1) / 2;
const centerColumnForSeat = (seatNumber: number) => 133 - seatNumber;
const rightColumnForSeat = (seatNumber: number) => 35 + seatNumber / 2;
const ACCESSIBLE_SEATS_BY_ROW: Record<string, number[]> = {
  // Blue cells from the provided Excel chart.
  A: [5, 6, 7, 8, 101, 102, 112, 113],
  U: [102, 104, 106, 109, 111, 113],
};

sections.forEach((section) => {
  rowLayouts.forEach((layout, rowIndex) => {
    const accessibleSeatNumbers = new Set(ACCESSIBLE_SEATS_BY_ROW[layout.row] ?? []);

    for (let seatNumber = 1; seatNumber <= layout.leftMaxOdd; seatNumber += 2) {
      const column = leftColumnForSeat(seatNumber);
      insertSeat.run(
        uuidv4(),
        section.id,
        layout.row,
        seatNumber,
        column * SEAT_GRID_STEP,
        (rowIndex * SEAT_GRID_STEP) + ROW_VERTICAL_START,
        accessibleSeatNumbers.has(seatNumber) ? 1 : 0
      );
    }

    layout.centerSeats.forEach((seatNumber) => {
      const column = centerColumnForSeat(seatNumber);
      insertSeat.run(
        uuidv4(),
        section.id,
        layout.row,
        seatNumber,
        column * SEAT_GRID_STEP,
        (rowIndex * SEAT_GRID_STEP) + ROW_VERTICAL_START,
        accessibleSeatNumbers.has(seatNumber) ? 1 : 0
      );
    });

    for (let seatNumber = 2; seatNumber <= layout.rightMaxEven; seatNumber += 2) {
      const column = rightColumnForSeat(seatNumber);
      insertSeat.run(
        uuidv4(),
        section.id,
        layout.row,
        seatNumber,
        column * SEAT_GRID_STEP,
        (rowIndex * SEAT_GRID_STEP) + ROW_VERTICAL_START,
        accessibleSeatNumbers.has(seatNumber) ? 1 : 0
      );
    }
  });
});

console.log('Database seeded successfully!');

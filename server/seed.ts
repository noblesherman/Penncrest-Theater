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
// Larger floor layout: 15 rows, 20 seats per row
const insertSeat = db.prepare('INSERT INTO seats (id, sectionId, row, number, x, y) VALUES (?, ?, ?, ?, ?, ?)');

sections.forEach((section, secIndex) => {
  const rows = 15; 
  const cols = 20; 
  
  for (let r = 0; r < rows; r++) {
    const rowLabel = String.fromCharCode(65 + r); // A, B, C...
    for (let c = 1; c <= cols; c++) {
      insertSeat.run(
        uuidv4(),
        section.id,
        rowLabel,
        c,
        c * 40, // x coordinate
        (r * 40) + 100 // y coordinate
      );
    }
  }
});

console.log('Database seeded successfully!');

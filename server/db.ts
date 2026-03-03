import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve('server/theater.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db: Database.Database;

const initSchema = () => {
  // Create tables and indexes; any corruption will surface here
  db.exec(`
  CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    posterUrl TEXT,
    type TEXT, -- 'Musical', 'Play', 'Comedy'
    year INTEGER,
    accentColor TEXT
  );

  CREATE TABLE IF NOT EXISTS performances (
    id TEXT PRIMARY KEY,
    showId TEXT NOT NULL,
    date TEXT NOT NULL, -- ISO string
    FOREIGN KEY(showId) REFERENCES shows(id)
  );

  CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL -- in cents
  );

  CREATE TABLE IF NOT EXISTS seats (
    id TEXT PRIMARY KEY,
    sectionId TEXT NOT NULL,
    row TEXT NOT NULL,
    number INTEGER NOT NULL,
    x INTEGER, -- for visual map
    y INTEGER, -- for visual map
    isAccessible INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(sectionId) REFERENCES sections(id)
  );

  CREATE TABLE IF NOT EXISTS seat_holds (
    id TEXT PRIMARY KEY,
    seatId TEXT NOT NULL,
    performanceId TEXT NOT NULL,
    expiresAt INTEGER NOT NULL, -- timestamp
    token TEXT NOT NULL, -- session token
    FOREIGN KEY(seatId) REFERENCES seats(id),
    FOREIGN KEY(performanceId) REFERENCES performances(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customerEmail TEXT NOT NULL,
    stripeSessionId TEXT,
    status TEXT NOT NULL, -- 'pending', 'paid', 'cancelled'
    totalAmount INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    token TEXT -- session token from holds
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL,
    seatId TEXT NOT NULL,
    performanceId TEXT NOT NULL,
    qrCode TEXT NOT NULL,
    used INTEGER DEFAULT 0, -- boolean
    FOREIGN KEY(orderId) REFERENCES orders(id),
    FOREIGN KEY(seatId) REFERENCES seats(id),
    FOREIGN KEY(performanceId) REFERENCES performances(id)
  );
  
  -- Index for faster seat lookups
  CREATE INDEX IF NOT EXISTS idx_seat_holds_perf ON seat_holds(performanceId);
  CREATE INDEX IF NOT EXISTS idx_tickets_perf ON tickets(performanceId);
`);

  // Lightweight migration for existing local DBs created before isAccessible.
  const seatColumns = db.prepare(`PRAGMA table_info(seats)`).all() as Array<{ name: string }>;
  const hasAccessibleColumn = seatColumns.some((column) => column.name === 'isAccessible');
  if (!hasAccessibleColumn) {
    db.exec('ALTER TABLE seats ADD COLUMN isAccessible INTEGER NOT NULL DEFAULT 0');
  }
};

try {
  db = new Database(dbPath);
  initSchema();
} catch (error) {
  console.error('Database appears corrupted. Recreating...', error);
  try {
    db.close();
  } catch (_) {
    // ignore close errors
  }
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  db = new Database(dbPath);
  initSchema();
}

export default db;

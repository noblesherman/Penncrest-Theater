import express from 'express';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import ical from 'node-ical';

// ... existing code ...

// Initialize Stripe (mock or real)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  // apiVersion: '2025-01-27.acacia', // Use latest API version available
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes ---

  // Get all shows
  app.get('/api/shows', (req, res) => {
    const shows = db.prepare('SELECT * FROM shows ORDER BY year DESC').all();
    res.json(shows);
  });

  // Get single show with performances
  app.get('/api/shows/:id', (req, res) => {
    const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(req.params.id);
    if (!show) return res.status(404).json({ error: 'Show not found' });
    
    const performances = db.prepare('SELECT * FROM performances WHERE showId = ? ORDER BY date ASC').all(req.params.id);
    res.json({ ...show, performances });
  });

  // Get seat map availability for a performance
  app.get('/api/performances/:id/seats', (req, res) => {
    const { id } = req.params;
    
    // Get all seats
    const seats = db.prepare(`
      SELECT s.*, sec.name as sectionName, sec.price 
      FROM seats s 
      JOIN sections sec ON s.sectionId = sec.id
    `).all();

    // Get sold tickets for this performance
    const soldTickets = db.prepare('SELECT seatId FROM tickets WHERE performanceId = ?').all(id);
    const soldSeatIds = new Set(soldTickets.map((t: any) => t.seatId));

    // Get active holds for this performance
    const now = Date.now();
    const holds = db.prepare('SELECT seatId FROM seat_holds WHERE performanceId = ? AND expiresAt > ?').all(id, now);
    const heldSeatIds = new Set(holds.map((h: any) => h.seatId));

    // Combine status
    const seatsWithStatus = seats.map((seat: any) => {
      let status = 'available';
      if (soldSeatIds.has(seat.id)) status = 'sold';
      else if (heldSeatIds.has(seat.id)) status = 'held';
      
      return { ...seat, status };
    });

    res.json(seatsWithStatus);
  });

  // Create a hold
  app.post('/api/hold', (req, res) => {
    const { seatIds, performanceId } = req.body;
    const token = uuidv4(); // Session token for the user
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Transaction to ensure atomicity
    const holdTransaction = db.transaction(() => {
      // Check if any seat is already sold or held
      for (const seatId of seatIds) {
        const isSold = db.prepare('SELECT 1 FROM tickets WHERE seatId = ? AND performanceId = ?').get(seatId, performanceId);
        if (isSold) throw new Error(`Seat ${seatId} is already sold`);

        const isHeld = db.prepare('SELECT 1 FROM seat_holds WHERE seatId = ? AND performanceId = ? AND expiresAt > ?').get(seatId, performanceId, Date.now());
        if (isHeld) throw new Error(`Seat ${seatId} is currently held`);
      }

      // Create holds
      const insertHold = db.prepare('INSERT INTO seat_holds (id, seatId, performanceId, expiresAt, token) VALUES (?, ?, ?, ?, ?)');
      for (const seatId of seatIds) {
        insertHold.run(uuidv4(), seatId, performanceId, expiresAt, token);
      }
    });

    try {
      holdTransaction();
      res.json({ success: true, token, expiresAt });
    } catch (error: any) {
      res.status(409).json({ error: error.message });
    }
  });

  // Create Checkout Session
  app.post('/api/checkout', async (req, res) => {
    const { token, performanceId, seatIds } = req.body;

    // Verify holds belong to this token
    const holds = db.prepare('SELECT * FROM seat_holds WHERE token = ? AND performanceId = ? AND expiresAt > ?').all(token, performanceId, Date.now());
    
    if (holds.length !== seatIds.length) {
      return res.status(400).json({ error: 'Holds expired or invalid' });
    }

    // Calculate total
    let totalAmount = 0;
    const lineItems = [];
    
    for (const seatId of seatIds) {
      const seat = db.prepare('SELECT s.*, sec.price, sec.name as sectionName FROM seats s JOIN sections sec ON s.sectionId = sec.id WHERE s.id = ?').get(seatId);
      totalAmount += seat.price;
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${seat.sectionName} - Row ${seat.row} Seat ${seat.number}`,
          },
          unit_amount: seat.price,
        },
        quantity: 1,
      });
    }

    try {
      // Create pending order
      const orderId = uuidv4();
      
      // If we had a real Stripe key, we'd create a session
      let session;
      if (process.env.STRIPE_SECRET_KEY) {
         session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: lineItems,
          mode: 'payment',
          success_url: `${process.env.APP_URL}/confirmation?orderId=${orderId}`,
          cancel_url: `${process.env.APP_URL}/shows`,
          metadata: {
            orderId,
            performanceId,
            seatIds: JSON.stringify(seatIds)
          }
        });
      } else {
        // Mock session for demo
        session = {
          id: `sess_${uuidv4()}`,
          url: `${process.env.APP_URL}/confirmation?orderId=${orderId}&mock_success=true` 
        };
      }

      db.prepare('INSERT INTO orders (id, customerEmail, stripeSessionId, status, totalAmount, createdAt, token) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        orderId,
        'pending@example.com', // Placeholder until webhook
        session.id,
        'pending',
        totalAmount,
        Date.now(),
        token
      );

      res.json({ url: session.url });

    } catch (error: any) {
      console.error('Stripe error:', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  // Mock Webhook (since we can't receive real webhooks easily in this env without ngrok)
  // In a real app, this would be a POST from Stripe
  app.post('/api/mock-webhook', (req, res) => {
    const { orderId } = req.body;
    
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status === 'paid') return res.json({ success: true });

    // Finalize order
    const finalizeTransaction = db.transaction(() => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('paid', orderId);
      
      // Find holds by token
      const holds = db.prepare('SELECT * FROM seat_holds WHERE token = ?').all(order.token);
      
      const insertTicket = db.prepare('INSERT INTO tickets (id, orderId, seatId, performanceId, qrCode) VALUES (?, ?, ?, ?, ?)');
      
      for (const hold of holds) {
        insertTicket.run(uuidv4(), orderId, hold.seatId, hold.performanceId, uuidv4());
        // Remove hold
        db.prepare('DELETE FROM seat_holds WHERE id = ?').run(hold.id);
      }
    });

    finalizeTransaction();
    res.json({ success: true });
  });
  
  // Get Order Confirmation
  app.get('/api/orders/:id', (req, res) => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      
      const tickets = db.prepare(`
        SELECT t.*, s.row, s.number, sec.name as sectionName, p.date, sh.title as showTitle
        FROM tickets t
        JOIN seats s ON t.seatId = s.id
        JOIN sections sec ON s.sectionId = sec.id
        JOIN performances p ON t.performanceId = p.id
        JOIN shows sh ON p.showId = sh.id
        WHERE t.orderId = ?
      `).all(order.id);
      
      res.json({ order, tickets });
  });

  // Admin: Dashboard Stats
  app.get('/api/admin/stats', (req, res) => {
      const totalSales = db.prepare('SELECT SUM(totalAmount) as total FROM orders WHERE status = "paid"').get();
      const ticketsSold = db.prepare('SELECT COUNT(*) as count FROM tickets').get();
      res.json({ totalSales: totalSales.total || 0, ticketsSold: ticketsSold.count || 0 });
  });

  // Get Calendar Events
  app.get('/api/calendar', async (req, res) => {
    try {
      const calendarUrl = 'https://calendar.google.com/calendar/ical/noblesherman7%40gmail.com/public/basic.ics';
      const events = await ical.async.fromURL(calendarUrl);
      
      const formattedEvents = Object.values(events)
        .filter((event: any) => event.type === 'VEVENT')
        .map((event: any) => ({
          title: event.summary,
          date: event.start,
          end: event.end,
          description: event.description,
          location: event.location,
          type: 'event' // Default type
        }));

      res.json(formattedEvents);
    } catch (error) {
      console.error('Calendar fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
  });


  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

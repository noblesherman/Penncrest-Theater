import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import Stripe from 'stripe';
import { env } from './config.js';
import { json } from 'express';
import { router as holdRouter } from './routes/hold.js';
import { router as seatRouter } from './routes/seats.js';
import { router as checkoutRouter } from './routes/checkout.js';
import { router as webhookRouter } from './routes/webhook.js';
import { router as healthRouter } from './routes/health.js';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

async function bootstrap() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: [env.APP_URL, env.ADMIN_APP_URL], credentials: true }));
  // Use JSON parser for all routes except Stripe webhook (handled in router)
  app.use((req, res, next) => {
    if (req.path === '/api/stripe/webhook') return next();
    return json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } })(req, res, next);
  });

  // Stripe webhook needs raw body; route-specific middleware inside router

  app.use('/api', healthRouter);
  app.use('/api', holdRouter);
  app.use('/api', seatRouter);
  app.use('/api', checkoutRouter);
  app.use('/api', webhookRouter);

  // Fallback
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(err?.status || 500).json({ error: err.message || 'Internal server error' });
  });

  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});

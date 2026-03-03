import { Router, raw } from 'express';
import { webhookController } from '../services/webhook-service.js';

export const router = Router();

// Stripe requires raw body to verify signature
router.post('/stripe/webhook', raw({ type: 'application/json' }), webhookController.handleWebhook);

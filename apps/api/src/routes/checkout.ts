import { Router } from 'express';
import { checkoutController } from '../services/checkout-service.js';

export const router = Router();

router.post('/performances/:id/checkout', checkoutController.createCheckoutSession);

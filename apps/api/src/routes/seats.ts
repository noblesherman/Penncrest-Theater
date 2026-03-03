import { Router } from 'express';
import { seatController } from '../services/seat-service.js';

export const router = Router();

router.get('/performances/:id/seats', seatController.getSeats);

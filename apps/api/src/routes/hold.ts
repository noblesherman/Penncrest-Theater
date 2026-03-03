import { Router } from 'express';
import { holdController } from '../services/hold-service.js';

export const router = Router();

router.post('/performances/:id/hold', holdController.createHold);
router.post('/holds/:holdId/release', holdController.releaseHold);

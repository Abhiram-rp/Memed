import { Router } from 'express';
import { getMyEarnings } from '../controllers/creatorController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.get('/me/earnings', authenticate, requireRole('creator'), asyncHandler(getMyEarnings));

export { router as creatorsRouter };
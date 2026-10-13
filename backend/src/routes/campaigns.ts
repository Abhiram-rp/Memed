import { Router } from 'express';
import { createCampaign } from '../controllers/campaignController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { createCampaignSchema } from '../validators/campaign';

const router = Router();

// Phase 4: only the create route is in scope for now.
router.post(
  '/',
  authenticate,
  requireRole('brand'),
  validate(createCampaignSchema, 'body'),
  asyncHandler(createCampaign),
);

export { router as campaignsRouter };
import { Router } from 'express';
import { createCampaign, listMyCampaigns } from '../controllers/campaignController';
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

// `/mine` MUST be registered before any `/:id` route so it is not swallowed
// by the id param matcher.
router.get('/mine', authenticate, requireRole('brand'), asyncHandler(listMyCampaigns));

export { router as campaignsRouter };
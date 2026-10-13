import { Router } from 'express';
import {
  createCampaign,
  getCampaignById,
  listCampaignSubmissions,
  listMyCampaigns,
} from '../controllers/campaignController';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { createCampaignSchema } from '../validators/campaign';
import { objectIdParamSchema } from '../validators/common';

const router = Router();

// Route order matters: `/mine` must be registered before `/:id`, or the id
// matcher would swallow it. Final order: POST /, GET /mine, GET /:id,
// GET /:id/submissions. All campaign routes require the brand role.
router.post(
  '/',
  authenticate,
  requireRole('brand'),
  validate(createCampaignSchema, 'body'),
  asyncHandler(createCampaign),
);

router.get('/mine', authenticate, requireRole('brand'), asyncHandler(listMyCampaigns));

router.get(
  '/:id',
  authenticate,
  requireRole('brand'),
  validate(objectIdParamSchema, 'params'),
  asyncHandler(getCampaignById),
);

router.get(
  '/:id/submissions',
  authenticate,
  requireRole('brand'),
  validate(objectIdParamSchema, 'params'),
  asyncHandler(listCampaignSubmissions),
);

export { router as campaignsRouter };
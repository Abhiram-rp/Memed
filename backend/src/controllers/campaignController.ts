import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { toCampaignDTO } from '../services/campaignDto';
import {
  create as createCampaignRecord,
  getCampaignById as getCampaignByIdForBrand,
  listCampaignSubmissions as listCampaignSubmissionsForBrand,
  listMyCampaigns as listMyCampaignsForBrand,
} from '../services/campaignService';
import type { CreateCampaignInput } from '../validators/campaign';

/**
 * POST /api/campaigns — thin handler (spec §9): the route chain already ran
 * `authenticate` + `requireRole('brand')` + `validate`, so `req.user` is a
 * brand and `req.body` is a parsed `CreateCampaignInput`.
 */
export async function createCampaign(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const campaign = await createCampaignRecord(req.user.id, req.body as CreateCampaignInput);
  res.status(201).json({ campaign: toCampaignDTO(campaign) });
}

/**
 * GET /api/campaigns/mine — thin handler: the route chain already ran
 * `authenticate` + `requireRole('brand')`, so `req.user` is the brand whose
 * campaigns are listed.
 */
export async function listMyCampaigns(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const items = await listMyCampaignsForBrand(req.user.id);
  res.json({ items });
}

/**
 * GET /api/campaigns/:id — thin handler. The route chain validated `:id` and
 * enforced the brand role; the service scopes the lookup by owner so another
 * brand's campaign is a plain 404.
 */
export async function getCampaignById(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const campaign = await getCampaignByIdForBrand(req.params.id as string, req.user.id);
  res.json({ campaign });
}

/**
 * GET /api/campaigns/:id/submissions — thin handler. Same ownership rule as
 * the single-campaign read; the service returns the submissions list.
 */
export async function listCampaignSubmissions(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const items = await listCampaignSubmissionsForBrand(req.params.id as string, req.user.id);
  res.json({ items });
}
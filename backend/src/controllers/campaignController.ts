import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { toCampaignDTO } from '../services/campaignDto';
import { create as createCampaignRecord } from '../services/campaignService';
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
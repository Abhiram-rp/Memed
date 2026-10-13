import type { Request, Response } from 'express';
import { UnauthenticatedError } from '../errors';
import { toCampaignDTO } from '../services/campaignDto';
import {
  create as createCampaignRecord,
  getCampaignByIdForBrand,
  getCampaignByIdForCreator,
  listCampaignSubmissions as listCampaignSubmissionsForBrand,
  listLive as listLiveCampaigns,
  listMyCampaigns as listMyCampaignsForBrand,
} from '../services/campaignService';
import type { CreateCampaignInput } from '../validators/campaign';
import type { PaginationQuery } from '../validators/common';

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
 * allows both brand and creator roles.
 */
export async function getCampaignById(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const id = req.params.id as string;
  if (req.user.role === 'brand') {
    const campaign = await getCampaignByIdForBrand(id, req.user.id);
    res.json({ campaign });
    return;
  }
  const campaign = await getCampaignByIdForCreator(id);
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

/**
 * GET /api/campaigns — list live campaigns for creators (spec Phase 5 task 1).
 * Route chain: authenticate -> requireRole('creator') -> validate(query).
 */
export async function listLiveCampaignsHandler(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const { page, limit } = req.query as unknown as PaginationQuery;
  const result = await listLiveCampaigns(page, limit);
  res.json(result);
}
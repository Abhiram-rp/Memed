import { normalizeMilestones } from '../domain/milestones';
import { Campaign, type CampaignDocument } from '../models/Campaign';
import type { CreateCampaignInput } from '../validators/campaign';

/**
 * Create a campaign for a brand (spec Phase 4 task 2). The ladder is sorted
 * ascending by `views` before storing (D8); `spent` starts at 0 and the
 * campaign is `live` immediately (D10). Returns the saved document with the
 * brand populated so the DTO can render `brand: { id, name }`.
 */
export async function create(brandId: string, input: CreateCampaignInput): Promise<CampaignDocument> {
  const campaign = new Campaign({
    brand: brandId,
    name: input.name,
    platform: input.platform,
    budget: input.budget,
    spent: 0,
    status: 'live',
    milestones: normalizeMilestones(input.milestones),
  });
  await campaign.save();
  await campaign.populate('brand', 'name');
  return campaign;
}
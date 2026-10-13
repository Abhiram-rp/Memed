import type { Types } from 'mongoose';
import { normalizeMilestones } from '../domain/milestones';
import { Campaign, type CampaignDocument } from '../models/Campaign';
import { Submission } from '../models/Submission';
import { toCampaignDTO, type CampaignDTO } from './campaignDto';
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

interface SubmissionCountRow {
  _id: Types.ObjectId;
  count: number;
}

/**
 * The brand's own campaigns, newest first, each with its submission count
 * (spec Phase 4 task 3). Counts come from ONE aggregation grouped by campaign
 * and are merged via a Map — no N+1 queries; campaigns without submissions
 * get `submissionCount: 0`.
 */
export async function listMyCampaigns(brandId: string): Promise<CampaignDTO[]> {
  const campaigns = await Campaign.find({ brand: brandId }).sort({ createdAt: -1 }).lean();

  const ids = campaigns.map((campaign) => campaign._id);
  const rows = await Submission.aggregate<SubmissionCountRow>([
    { $match: { campaign: { $in: ids } } },
    { $group: { _id: '$campaign', count: { $sum: 1 } } },
  ]);

  const countByCampaign = new Map<string, number>();
  for (const row of rows) {
    countByCampaign.set(row._id.toString(), row.count);
  }

  return campaigns.map((campaign) =>
    toCampaignDTO(campaign, {
      submissionCount: countByCampaign.get(campaign._id.toString()) ?? 0,
    }),
  );
}
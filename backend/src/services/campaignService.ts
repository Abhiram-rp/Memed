import type { Types } from 'mongoose';
import { normalizeMilestones } from '../domain/milestones';
import { NotFoundError } from '../errors';
import { Campaign, type CampaignDocument } from '../models/Campaign';
import { Submission } from '../models/Submission';
import { toCampaignDTO, type CampaignDTO } from './campaignDto';
import { toSubmissionDTO, type SubmissionDTO } from './submissionDto';
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

/**
 * One campaign, but only for its owning brand (spec Phase 4 task 4). The query
 * scopes by `brand`, so another brand's id yields the same 404 as an unknown
 * id — ownership is never revealed.
 */
export async function getCampaignByIdForBrand(id: string, brandId: string): Promise<CampaignDTO> {
  const campaign = await Campaign.findOne({ _id: id, brand: brandId }).lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }
  return toCampaignDTO(campaign);
}

export async function getCampaignByIdForCreator(id: string): Promise<CampaignDTO> {
  const campaign = await Campaign.findOne({ _id: id, status: 'live' }).populate('brand', 'name').lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }
  return toCampaignDTO(campaign);
}

/**
 * Submissions for one of the brand's own campaigns, newest first (spec Phase 4
 * task 4). Ownership is checked first; the submissions are then read in one
 * query with the creator populated.
 */
export async function listCampaignSubmissions(
  id: string,
  brandId: string,
): Promise<SubmissionDTO[]> {
  const campaign = await Campaign.findOne({ _id: id, brand: brandId }).lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  const submissions = await Submission.find({ campaign: id })
    .populate('creator', 'name')
    .sort({ createdAt: -1 })
    .lean();

  return submissions.map((submission) =>
    toSubmissionDTO(submission, {
      campaign: {
        id: campaign._id.toString(),
        name: campaign.name,
        platform: campaign.platform,
      },
    }),
  );
}

export interface LiveCampaignsResult {
  items: CampaignDTO[];
  page: number;
  limit: number;
  total: number;
}

/**
 * List live campaigns for creators (spec Phase 5 task 1). Returns paginated
 * results with brand name populated and remaining budget computed via DTO.
 */
export async function listLive(page: number, limit: number): Promise<LiveCampaignsResult> {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Campaign.find({ status: 'live' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('brand', 'name')
      .lean(),
    Campaign.countDocuments({ status: 'live' }),
  ]);

  return {
    items: items.map((campaign) => toCampaignDTO(campaign)),
    page,
    limit,
    total,
  };
}
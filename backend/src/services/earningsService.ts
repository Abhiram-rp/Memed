import { Types } from 'mongoose';
import { Campaign } from '../models/Campaign';
import { Submission } from '../models/Submission';

/** Per-campaign earnings row (spec Phase 5 task 4). */
export interface EarningsByCampaign {
  campaignId: string;
  campaignName: string;
  paidAmount: number;
  submissionCount: number;
}

/** Earnings summary for one creator (spec Phase 5 task 4). */
export interface CreatorEarnings {
  totalEarnings: number;
  submissionCount: number;
  byCampaign: EarningsByCampaign[];
}

interface EarningsRow {
  _id: Types.ObjectId;
  paidAmount: number;
  submissionCount: number;
}

/**
 * Earnings summary for one creator (spec Phase 5 task 4). ONE aggregation
 * groups the creator's submissions by campaign; campaign names come from a
 * second query and are merged via a Map — no N+1 queries. A creator with no
 * submissions gets `{ totalEarnings: 0, submissionCount: 0, byCampaign: [] }`.
 */
export async function getCreatorEarnings(creatorId: string): Promise<CreatorEarnings> {
  // Aggregation does NOT cast strings to ObjectId: without the explicit
  // conversion the $match would silently match nothing.
  const rows = await Submission.aggregate<EarningsRow>([
    { $match: { creator: new Types.ObjectId(creatorId) } },
    {
      $group: {
        _id: '$campaign',
        paidAmount: { $sum: '$paidAmount' },
        submissionCount: { $sum: 1 },
      },
    },
  ]);

  if (rows.length === 0) {
    return { totalEarnings: 0, submissionCount: 0, byCampaign: [] };
  }

  const campaigns = await Campaign.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name')
    .lean();
  const nameByCampaign = new Map(
    campaigns.map((campaign) => [campaign._id.toString(), campaign.name]),
  );

  const byCampaign: EarningsByCampaign[] = rows.map((row) => ({
    campaignId: row._id.toString(),
    campaignName: nameByCampaign.get(row._id.toString()) ?? '',
    paidAmount: row.paidAmount,
    submissionCount: row.submissionCount,
  }));

  return {
    totalEarnings: byCampaign.reduce((sum, row) => sum + row.paidAmount, 0),
    submissionCount: byCampaign.reduce((sum, row) => sum + row.submissionCount, 0),
    byCampaign,
  };
}
import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { calculateEntitledPayout, calculatePayoutDelta } from '../domain/payout';
import { detectSpike } from '../domain/spike';
import { NotFoundError } from '../errors';
import { Campaign, type CampaignStatus } from '../models/Campaign';
import { Submission } from '../models/Submission';
import { invalidateCampaignCache } from './cacheService';
import type { SubmissionLike } from './submissionDto';

/** Payout movement reported by a single view update (spec §5.4). */
export interface ViewUpdatePayout {
  /** `paidAmount` before this update was applied. */
  previousPaid: number;
  /** Amount paid by this update: `clamp(entitledAmount - previousPaid, 0, remaining)`. */
  delta: number;
  /** `paidAmount` after this update. */
  paidAmount: number;
  /** High-water entitlement after this update (never decreases, D5). */
  entitledAmount: number;
  /** True when the submission is still owed more than the budget allowed. */
  capped: boolean;
}

/** Campaign snapshot after this update (spec §5.4). */
export interface ViewUpdateCampaign {
  id: string;
  budget: number;
  spent: number;
  remaining: number;
  status: CampaignStatus;
}

/** Everything the PATCH controller needs to render the §5.4 response. */
export interface ViewUpdateResult {
  /** Plain object accepted directly by `toSubmissionDTO` (carries the campaign summary). */
  submission: SubmissionLike;
  payout: ViewUpdatePayout;
  campaign: ViewUpdateCampaign;
}

/**
 * Transactional view update + payout engine (spec §6.2, D3–D7).
 *
 * All reads/writes run inside one MongoDB transaction so concurrent updates can
 * never overspend a campaign budget or double-pay a submission. Every payout
 * number comes from `domain/payout.ts`; every amount and the campaign `spent`
 * move together or not at all.
 *
 * `views` is the ABSOLUTE current count (spec §5.4). Entitlement is a
 * high-water mark (D5); a decrease never claws money back.
 */
export async function updateViews(submissionId: string, views: number): Promise<ViewUpdateResult> {
  const session = await mongoose.startSession();
  // `withTransaction`'s own return value varies between driver versions, so the
  // callback assigns to this outer variable instead. Each retry re-assigns it.
  let result: ViewUpdateResult | undefined;

  try {
    await session.withTransaction(async () => {
      // Fresh reads every attempt: the callback may re-run on a transient retry.
      const submission = await Submission.findById(submissionId).session(session);
      if (!submission) {
        // Domain error: aborts the transaction and is NOT retried.
        throw new NotFoundError('Submission not found');
      }

      const campaign = await Campaign.findById(submission.campaign).session(session);
      if (!campaign) {
        throw new NotFoundError('Campaign not found');
      }

      const now = new Date();

      const newEntitled = Math.max(
        submission.entitledAmount,
        calculateEntitledPayout(views, campaign.milestones),
      );
      const remaining = campaign.budget - campaign.spent;
      const { delta, capped } = calculatePayoutDelta({
        entitledAmount: newEntitled,
        alreadyPaid: submission.paidAmount,
        remainingBudget: remaining,
      });

      // Bonus flag only (D15): it never changes or blocks a payout.
      const spike = detectSpike(
        {
          previousViews: submission.views,
          newViews: views,
          previousUpdatedAt: submission.lastViewsUpdatedAt,
          now,
        },
        { minDelta: env.SPIKE_MIN_DELTA, ratePerMin: env.SPIKE_RATE_PER_MIN },
      );

      const previousPaid = submission.paidAmount;

      // ALWAYS write the submission: this write serializes concurrent updates on
      // the same document (the Mongo write conflict makes the loser retry).
      submission.views = views;
      submission.entitledAmount = newEntitled;
      submission.paidAmount = previousPaid + delta;
      submission.lastViewsUpdatedAt = now;
      if (spike.flagged && !submission.flagged) {
        submission.flagged = true;
        submission.flagReason = spike.reason ?? 'Unusually fast view growth';
        submission.flaggedAt = now;
      }
      await submission.save({ session });

      let newSpent = campaign.spent;
      if (delta > 0) {
        newSpent = campaign.spent + delta;
        const newStatus: CampaignStatus = newSpent === campaign.budget ? 'exhausted' : 'live';
        // Compare-and-set on the exact `spent` we read: if another transaction
        // already moved it, matchedCount is 0 and we abort to retry (§6.2).
        const updated = await Campaign.updateOne(
          { _id: campaign._id, spent: campaign.spent },
          { $set: { spent: newSpent, status: newStatus } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new Error('Concurrent campaign update');
        }
      }

      const newStatus: CampaignStatus = newSpent === campaign.budget ? 'exhausted' : 'live';

      // Plain object so the campaign summary rides along for the submission DTO
      // (§5.4 renders the submission shape, which embeds the campaign).
      const submissionView = {
        ...submission.toObject(),
        campaign: {
          _id: campaign._id,
          name: campaign.name,
          platform: campaign.platform,
        },
      };

      result = {
        submission: submissionView,
        payout: {
          previousPaid,
          delta,
          paidAmount: previousPaid + delta,
          entitledAmount: newEntitled,
          capped,
        },
        campaign: {
          id: campaign._id.toString(),
          budget: campaign.budget,
          spent: newSpent,
          remaining: campaign.budget - newSpent,
          status: newStatus,
        },
      };
    });

    const resolved = result;
    if (resolved === undefined) {
      throw new Error('View update transaction resolved without producing a result');
    }

    // Cache problems must never fail a payout (spec Phase 6 task 6).
    try {
      await invalidateCampaignCache();
    } catch (err) {
      logger.warn('Failed to invalidate the campaign cache after a view update', err);
    }

    return resolved;
  } finally {
    await session.endSession();
  }
}

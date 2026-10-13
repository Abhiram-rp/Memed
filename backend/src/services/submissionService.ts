import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { Campaign } from '../models/Campaign';
import { Submission, type SubmissionDocument } from '../models/Submission';
import { validateAndNormalizePostUrl } from '../domain/postUrl';
import type { CreateSubmissionInput } from '../validators/submission';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

export async function create(
  creatorId: string,
  input: CreateSubmissionInput,
): Promise<SubmissionDocument> {
  const campaign = await Campaign.findById(input.campaignId).lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (campaign.status !== 'live') {
    throw new ConflictError('Campaign is no longer live');
  }

  const validation = validateAndNormalizePostUrl(input.postUrl, campaign.platform);
  if (!validation.ok) {
    throw new ValidationError(validation.reason);
  }

  const now = new Date();
  const postUrl = input.postUrl.trim();

  try {
    const submission = await Submission.create({
      campaign: campaign._id,
      creator: creatorId,
      postUrl,
      normalizedUrl: validation.normalized,
      views: 0,
      entitledAmount: 0,
      paidAmount: 0,
      lastViewsUpdatedAt: now,
    });
    await submission.populate('campaign', 'name platform');
    return submission;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('This post has already been submitted');
    }
    throw err;
  }
}

export async function listMySubmissions(creatorId: string): Promise<SubmissionDocument[]> {
  const submissions = await Submission.find({ creator: creatorId })
    .sort({ createdAt: -1 })
    .populate('campaign', 'name platform')
    .lean();
  return submissions as unknown as SubmissionDocument[];
}

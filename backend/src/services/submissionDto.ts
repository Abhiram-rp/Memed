import type { CampaignPlatform } from '../models/Campaign';

/** Creator summary, present only when `creator` is populated. */
export interface SubmissionCreatorDTO {
  id: string;
  name: string;
}

/** Campaign summary carried on the submission (spec §5.3). */
export interface SubmissionCampaignDTO {
  id: string;
  name: string;
  platform: CampaignPlatform;
}

/** Public submission shape (spec §5.3) plus `creator` and derived `capped`. */
export interface SubmissionDTO {
  id: string;
  campaignId: string;
  campaign?: SubmissionCampaignDTO;
  postUrl: string;
  views: number;
  entitledAmount: number;
  paidAmount: number;
  /** Derived: `paidAmount < entitledAmount` (spec §5.3). */
  capped: boolean;
  flagged: boolean;
  flagReason: string | null;
  /** Present only when `creator` is populated. */
  creator?: SubmissionCreatorDTO;
  createdAt: Date;
}

/**
 * Structural input accepted by {@link toSubmissionDTO}: hydrated Mongoose
 * documents and `.lean()` / plain objects both work.
 */
export interface SubmissionLike {
  _id?: unknown;
  id?: unknown;
  campaign: unknown;
  postUrl: string;
  views: number;
  entitledAmount: number;
  paidAmount: number;
  flagged: boolean;
  flagReason?: string | null;
  creator?: unknown;
  createdAt: Date;
  __v?: unknown;
}

export interface ToSubmissionDTOOptions {
  /** Campaign summary to embed; the caller supplies it when it has the campaign. */
  campaign?: SubmissionCampaignDTO;
}

function resolveId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

/** Populated creators are user sub-documents with a string `name`. */
function toCreatorDTO(creator: unknown): SubmissionCreatorDTO | undefined {
  if (creator === null || typeof creator !== 'object') {
    return undefined;
  }
  const candidate = creator as { _id?: unknown; id?: unknown; name?: unknown };
  if (typeof candidate.name !== 'string') {
    return undefined;
  }
  const id = resolveId(candidate._id) ?? resolveId(candidate.id);
  if (id === undefined) {
    return undefined;
  }
  return { id, name: candidate.name };
}

/**
 * Maps a submission document or lean object to its public DTO. Only the listed
 * fields are copied, so `_id`, `__v`, `normalizedUrl` and other internals never
 * leak. `capped` is always derived, never read from the input.
 */
export function toSubmissionDTO(doc: SubmissionLike, opts?: ToSubmissionDTOOptions): SubmissionDTO {
  const id = resolveId(doc._id) ?? resolveId(doc.id);
  if (id === undefined) {
    throw new Error('toSubmissionDTO: submission is missing an id');
  }

  // `campaign` may be a bare ObjectId or a populated object; either way the id
  // string is what the API exposes as `campaignId`.
  const campaignId =
    (doc.campaign !== null && typeof doc.campaign === 'object'
      ? resolveId((doc.campaign as { _id?: unknown; id?: unknown })._id) ??
        resolveId((doc.campaign as { _id?: unknown; id?: unknown }).id)
      : resolveId(doc.campaign)) ?? '';

  const dto: SubmissionDTO = {
    id,
    campaignId,
    postUrl: doc.postUrl,
    views: doc.views,
    entitledAmount: doc.entitledAmount,
    paidAmount: doc.paidAmount,
    capped: doc.paidAmount < doc.entitledAmount,
    flagged: doc.flagged,
    flagReason: doc.flagReason ?? null,
    createdAt: doc.createdAt,
  };

  if (opts?.campaign !== undefined) {
    dto.campaign = opts.campaign;
  } else if (doc.campaign !== null && typeof doc.campaign === 'object') {
    const c = doc.campaign as {
      _id?: unknown;
      id?: unknown;
      name?: unknown;
      platform?: unknown;
    };
    const cid = resolveId(c._id) ?? resolveId(c.id);
    if (cid !== undefined && typeof c.name === 'string' && typeof c.platform === 'string') {
      dto.campaign = {
        id: cid,
        name: c.name,
        platform: c.platform as CampaignPlatform,
      };
    }
  }
  const creator = toCreatorDTO(doc.creator);
  if (creator !== undefined) {
    dto.creator = creator;
  }

  return dto;
}
import type { CampaignPlatform, CampaignStatus } from '../models/Campaign';

/** Minimal milestone shape carried through the campaign DTO. */
export interface CampaignMilestoneDTO {
  views: number;
  payout: number;
}

/** Brand summary, present only when the `brand` field is populated. */
export interface CampaignBrandDTO {
  id: string;
  name: string;
}

/** Public campaign shape returned by the campaign endpoints (spec §5.3). */
export interface CampaignDTO {
  id: string;
  name: string;
  platform: CampaignPlatform;
  budget: number;
  spent: number;
  /** Derived here and never stored: `budget - spent`. */
  remaining: number;
  status: CampaignStatus;
  milestones: CampaignMilestoneDTO[];
  /** Present only when `brand` is populated. */
  brand?: CampaignBrandDTO;
  /** Present only when the caller supplies it. */
  submissionCount?: number;
  createdAt: Date;
}

/**
 * Structural input accepted by {@link toCampaignDTO}. Deliberately loose so it
 * accepts both hydrated Mongoose documents and `.lean()` / plain objects.
 */
export interface CampaignLike {
  _id?: unknown;
  id?: unknown;
  name: string;
  platform: CampaignPlatform;
  budget: number;
  spent: number;
  status: CampaignStatus;
  milestones: ReadonlyArray<CampaignMilestoneDTO>;
  brand?: unknown;
  createdAt: Date;
  __v?: unknown;
}

export interface ToCampaignDTOOptions {
  submissionCount?: number;
}

function resolveId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

/**
 * Populated brands are user sub-documents/objects with a string `name`; an
 * unpopulated `brand` is a bare ObjectId (or id string) and is omitted.
 */
function toBrandDTO(brand: unknown): CampaignBrandDTO | undefined {
  if (brand === null || typeof brand !== 'object') {
    return undefined;
  }
  const candidate = brand as { _id?: unknown; id?: unknown; name?: unknown };
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
 * Maps a campaign document or lean object to its public DTO. Only the listed
 * fields are copied, so `_id`, `__v` and any other internal field never leak.
 */
export function toCampaignDTO(doc: CampaignLike, opts?: ToCampaignDTOOptions): CampaignDTO {
  const id = resolveId(doc._id) ?? resolveId(doc.id);
  if (id === undefined) {
    throw new Error('toCampaignDTO: campaign is missing an id');
  }

  const dto: CampaignDTO = {
    id,
    name: doc.name,
    platform: doc.platform,
    budget: doc.budget,
    spent: doc.spent,
    remaining: doc.budget - doc.spent,
    status: doc.status,
    milestones: doc.milestones.map((milestone) => ({
      views: milestone.views,
      payout: milestone.payout,
    })),
    createdAt: doc.createdAt,
  };

  const brand = toBrandDTO(doc.brand);
  if (brand !== undefined) {
    dto.brand = brand;
  }
  if (opts?.submissionCount !== undefined) {
    dto.submissionCount = opts.submissionCount;
  }

  return dto;
}

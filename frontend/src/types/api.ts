/**
 * Shared API types — mirrors MEMED_BUILD_SPEC.md section 5 (API Contract) exactly.
 * All money values are integer rupees (D1).
 */

export type Role = "brand" | "creator";

export type Platform = "instagram" | "youtube";

export type CampaignStatus = "live" | "exhausted";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Milestone {
  views: number;
  payout: number;
}

export interface Campaign {
  id: string;
  name: string;
  platform: Platform;
  budget: number;
  spent: number;
  remaining: number;
  status: CampaignStatus;
  milestones: Milestone[];
  /** Populated on campaign responses. */
  brand?: { id: string; name: string };
  /** Included on brand endpoints only. */
  submissionCount?: number;
  createdAt: string;
}

export interface Submission {
  id: string;
  campaignId: string;
  /** Populated on creator submission listings. */
  campaign?: { id: string; name: string; platform: Platform };
  /** Populated on brand campaign submission listings. */
  creator?: { id: string; name: string };
  postUrl: string;
  views: number;
  entitledAmount: number;
  paidAmount: number;
  /** capped = paidAmount < entitledAmount */
  capped: boolean;
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

export interface CampaignListResponse {
  items: Campaign[];
  page: number;
  limit: number;
  total: number;
}

export interface ItemsResponse<T> {
  items: T[];
}

export interface CreateCampaignInput {
  name: string;
  platform: Platform;
  budget: number;
  milestones: Milestone[];
}

export interface CreateSubmissionInput {
  campaignId: string;
  postUrl: string;
}

export interface PayoutResult {
  previousPaid: number;
  delta: number;
  paidAmount: number;
  entitledAmount: number;
  capped: boolean;
}

export interface UpdateViewsResponse {
  submission: Submission;
  payout: PayoutResult;
  campaign: {
    id: string;
    budget: number;
    spent: number;
    remaining: number;
    status: CampaignStatus;
  };
}

export interface EarningsByCampaign {
  campaignId: string;
  campaignName: string;
  paidAmount: number;
  submissionCount: number;
}

export interface Earnings {
  totalEarnings: number;
  submissionCount: number;
  byCampaign: EarningsByCampaign[];
}

export interface ApiErrorDetail {
  path: string;
  message: string;
}

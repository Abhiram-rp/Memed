/**
 * Typed fetch client for the Meme'd API (spec §5).
 *
 * - Base URL comes from `NEXT_PUBLIC_API_URL` (trailing slashes stripped).
 * - Non-2xx responses become a typed {@link ApiError} built from the standard
 *   error envelope `{ error: { code, message, details } }`.
 * - A 401 clears the stored token and (in the browser) redirects to `/login`,
 *   unless the caller opts out with `redirectOn401: false` — login and signup
 *   do, so a wrong password shows an inline error instead of a redirect.
 */

import { clearToken, getToken } from "./authStorage";
import type {
  ApiErrorDetail,
  AuthResponse,
  Campaign,
  CampaignListResponse,
  CreateCampaignInput,
  CreateSubmissionInput,
  Earnings,
  ItemsResponse,
  Role,
  Submission,
  UpdateViewsResponse,
  User,
} from "@/types/api";

const NETWORK_ERROR_MESSAGE =
  "Cannot reach the server. If it is hosted on a free tier it may be waking up - try again in a minute.";

const RAW_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

let cachedBaseUrl: string | null = null;

/** Resolves the API base URL once, throwing a clear error if it is not configured. */
function getBaseUrl(): string {
  if (cachedBaseUrl !== null) {
    return cachedBaseUrl;
  }
  if (RAW_BASE_URL === undefined || RAW_BASE_URL.trim() === "") {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Add it to frontend/.env.local (for example " +
        "NEXT_PUBLIC_API_URL=http://localhost:4000) and restart the dev server.",
    );
  }
  cachedBaseUrl = RAW_BASE_URL.trim().replace(/\/+$/, "");
  return cachedBaseUrl;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Attach `Authorization: Bearer <token>` when a token exists. Default true. */
  auth?: boolean;
  /** Clear the token and redirect to /login on a 401. Default true. */
  redirectOn401?: boolean;
}

/** Reads a response body as JSON without crashing on an empty or non-JSON body. */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const details: ApiErrorDetail[] = [];
  for (const item of value) {
    if (item !== null && typeof item === "object") {
      const candidate = item as { path?: unknown; message?: unknown };
      if (typeof candidate.path === "string" && typeof candidate.message === "string") {
        details.push({ path: candidate.path, message: candidate.message });
      }
    }
  }
  return details.length > 0 ? details : undefined;
}

/** Builds an ApiError from the standard error envelope, with safe fallbacks. */
function toApiError(status: number, payload: unknown): ApiError {
  const envelope = payload as { error?: unknown } | null;
  const raw = envelope?.error;
  const error = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;

  const code = typeof error?.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  const message =
    typeof error?.message === "string" && error.message !== ""
      ? error.message
      : `Request failed with status ${status}`;

  return new ApiError(status, code, message, toDetails(error?.details));
}

function handleUnauthorized(): void {
  clearToken();
  if (typeof window === "undefined") {
    return;
  }
  const currentPath = window.location.pathname;
  if (currentPath !== "/login" && currentPath !== "/signup") {
    // This module is not a component, so no router is available here. A full
    // navigation is intentional: it discards all in-memory state for the
    // session that just became unauthenticated.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, redirectOn401 = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (auth) {
    const token = getToken();
    if (token !== null && token !== "") {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    if (response.status === 401 && redirectOn401) {
      handleUnauthorized();
    }
    throw toApiError(response.status, payload);
  }

  return payload as T;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const api = {
  auth: {
    async signup(input: SignupInput): Promise<AuthResponse> {
      return request<AuthResponse>("/api/auth/signup", {
        method: "POST",
        body: input,
        auth: false,
        redirectOn401: false,
      });
    },
    async login(input: LoginInput): Promise<AuthResponse> {
      return request<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: input,
        auth: false,
        redirectOn401: false,
      });
    },
    async me(): Promise<User> {
      const { user } = await request<{ user: User }>("/api/auth/me");
      return user;
    },
  },

  campaigns: {
    async create(input: CreateCampaignInput): Promise<Campaign> {
      const { campaign } = await request<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: input,
      });
      return campaign;
    },
    async mine(): Promise<ItemsResponse<Campaign>> {
      return request<ItemsResponse<Campaign>>("/api/campaigns/mine");
    },
    async list(page = 1, limit = 20): Promise<CampaignListResponse> {
      return request<CampaignListResponse>(`/api/campaigns?page=${page}&limit=${limit}`);
    },
    async get(id: string): Promise<Campaign> {
      const { campaign } = await request<{ campaign: Campaign }>(`/api/campaigns/${id}`);
      return campaign;
    },
    async submissions(id: string): Promise<ItemsResponse<Submission>> {
      return request<ItemsResponse<Submission>>(`/api/campaigns/${id}/submissions`);
    },
  },

  submissions: {
    async create(input: CreateSubmissionInput): Promise<Submission> {
      const { submission } = await request<{ submission: Submission }>("/api/submissions", {
        method: "POST",
        body: input,
      });
      return submission;
    },
    async mine(): Promise<ItemsResponse<Submission>> {
      return request<ItemsResponse<Submission>>("/api/submissions/mine");
    },
    /**
     * PATCH /api/submissions/:id/views is public (D13): no Authorization header
     * and no redirect on 401.
     */
    async updateViews(id: string, views: number): Promise<UpdateViewsResponse> {
      return request<UpdateViewsResponse>(`/api/submissions/${id}/views`, {
        method: "PATCH",
        body: { views },
        auth: false,
        redirectOn401: false,
      });
    },
  },

  creators: {
    async earnings(): Promise<Earnings> {
      const { earnings } = await request<{ earnings: Earnings }>("/api/creators/me/earnings");
      return earnings;
    },
  },
};

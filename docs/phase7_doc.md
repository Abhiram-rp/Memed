# Phase 7 — Frontend (Next.js + TypeScript)

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (section 5 API contract, decisions D1/D8/D9/D13/D16/D17, and §7 Phase 7); this doc
> explains the *code*.

## What this phase delivers

A complete Next.js (App Router, TypeScript, `src/`) frontend that talks to the Phase 1–6
backend. A brand can sign up, create a campaign and watch its budget drain; a creator can
sign up, browse live campaigns, submit a post, simulate platform views and watch earnings
grow. Everything is one plain global stylesheet, no UI/state/form libraries.

- **Scaffold** — `create-next-app` (TypeScript, App Router, ESLint, `src/`), `next.config.ts`
  with `cacheComponents` + `partialPrefetching`, `.env.example` = `NEXT_PUBLIC_API_URL=http://localhost:4000`.
- **`lib/api.ts`** — typed `request<T>(path, options)` wrapper: attaches the bearer token,
  parses JSON, throws a typed `ApiError { status, code, message, details }`, and on `401`
  clears auth and redirects to `/login` (opt-out for login/signup).
- **`lib/authStorage.ts`** — SSR-safe `localStorage` token helpers (D16).
- **`context/AuthContext.tsx`** — `{ user, token, loading, login, signup, logout }`; loads
  `/api/auth/me` on mount; hydration-safe (localStorage only read inside `useEffect`).
- **`components/ProtectedRoute.tsx`** — redirects unauthenticated users to `/login` and
  wrong-role users to their own dashboard.
- **Pages** — `/` (role redirect), `/login`, `/signup` (role selector), `/brand` (create
  campaign + campaign list), `/creator` (earnings + live-campaign browser + my submissions).
- **Design system** — one `globals.css` (~1650 lines) with CSS-variable tokens, dark-first
  with a light-mode override, plus a full accessibility and mobile pass.
- **Loading/error/empty states** — skeletons, `EmptyState`, `ErrorMessage`, disabled buttons
  in flight, `en-IN` INR formatting everywhere.

**Exit criteria met:** with the backend running locally, the full manual run works — brand
signs up → creates a campaign → creator signs up → submits a post → simulates views →
earnings and brand spent/remaining update. Verified end-to-end over HTTP against the real
API (see *The tests* below).

**Commits:** `6b4cfca` (scaffold next.js app and base styles), `a2abca9` (typed api client
and shared types), `deac914` (auth context, route guard and login/signup pages), `22f0072`
(brand and creator dashboards), `bf0b512` (creator dashboard), `94bb2a9` (redesign UI with
design system, dashboards, states and a11y).

---

## Deep dive — `frontend/src/types/api.ts`

The single source of truth for every shape that crosses the wire. It mirrors
`MEMED_BUILD_SPEC.md` §5 exactly, so a change to the API contract starts here.

```ts
export type Role = "brand" | "creator";
export type Platform = "instagram" | "youtube";
export type CampaignStatus = "live" | "exhausted";

export interface User { id: string; name: string; email: string; role: Role; }
export interface AuthResponse { token: string; user: User; }
export interface Milestone { views: number; payout: number; }

export interface Campaign {
  id: string; name: string; platform: Platform;
  budget: number; spent: number; remaining: number;
  status: CampaignStatus; milestones: Milestone[];
  brand?: { id: string; name: string };   // populated on campaign responses
  submissionCount?: number;               // brand endpoints only
  createdAt: string;
}

export interface Submission {
  id: string; campaignId: string;
  campaign?: { id: string; name: string; platform: Platform }; // creator listings
  creator?: { id: string; name: string };                      // brand listings
  postUrl: string; views: number;
  entitledAmount: number; paidAmount: number;
  capped: boolean; flagged: boolean; flagReason: string | null;
  createdAt: string;
}

export interface CampaignListResponse { items: Campaign[]; page: number; limit: number; total: number; }
export interface ItemsResponse<T> { items: T[]; }

export interface CreateCampaignInput { name: string; platform: Platform; budget: number; milestones: Milestone[]; }
export interface CreateSubmissionInput { campaignId: string; postUrl: string; }

export interface PayoutResult {
  previousPaid: number; delta: number; paidAmount: number;
  entitledAmount: number; capped: boolean;
}
export interface UpdateViewsResponse {
  submission: Submission; payout: PayoutResult;
  campaign: { id: string; budget: number; spent: number; remaining: number; status: CampaignStatus };
}

export interface EarningsByCampaign { campaignId: string; campaignName: string; paidAmount: number; submissionCount: number; }
export interface Earnings { totalEarnings: number; submissionCount: number; byCampaign: EarningsByCampaign[]; }

export interface ApiErrorDetail { path: string; message: string; }
```

- **All money is `number` (integer rupees, D1)** — never a string, never paise.
- **`capped` and `flagged` are booleans the UI renders directly** as badges; `flagReason`
  is `string | null` and becomes the badge's `title` tooltip.
- **`campaign?` / `creator?` are optional** because the backend populates them only on the
  relevant listing endpoints (creator listings carry `campaign`, brand listings carry
  `creator`). The UI guards with `?? "—"` / `?? "Brand"`.
- **`UpdateViewsResponse` is the one response with three top-level keys** (`submission`,
  `payout`, `campaign`) — the simulate-views control reads `payout.delta` / `payout.capped`
  to show its result chip.

## Deep dive — `frontend/src/lib/api.ts`

The typed fetch client. Every network call in the app goes through `request<T>`.

```ts
const RAW_BASE_URL = process.env.NEXT_PUBLIC_API_URL;
let cachedBaseUrl: string | null = null;

function getBaseUrl(): string {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  if (RAW_BASE_URL === undefined || RAW_BASE_URL.trim() === "") {
    throw new Error("NEXT_PUBLIC_API_URL is not set. Add it to frontend/.env.local …");
  }
  cachedBaseUrl = RAW_BASE_URL.trim().replace(/\/+$/, "");
  return cachedBaseUrl;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];
  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message); this.name = "ApiError";
    this.status = status; this.code = code; this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;          // attach Authorization: Bearer <token> (default true)
  redirectOn401?: boolean; // clear token + redirect to /login on 401 (default true)
}
```

`request<T>` itself:

```ts
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, redirectOn401 = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token !== null && token !== "") headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }

  const payload = await readJson(response);

  if (!response.ok) {
    if (response.status === 401 && redirectOn401) handleUnauthorized();
    throw toApiError(response.status, payload);
  }
  return payload as T;
}
```

- **Base URL is resolved once and cached.** `NEXT_PUBLIC_API_URL` is inlined at build time;
  trailing slashes are stripped so `${base}${path}` never doubles up. A missing variable
  throws a message that names the exact fix.
- **`readJson` never crashes.** It reads the body as text and returns `null` for an empty or
  non-JSON body, so a 204 or an HTML error page becomes a clean `ApiError` instead of a
  `SyntaxError`.
- **`toApiError` reads the standard envelope** `{ error: { code, message, details } }` with
  safe fallbacks (`code` → `"UNKNOWN"`, `message` → `"Request failed with status N"`).
  `toDetails` keeps only well-formed `{ path, message }` entries.
- **Network failure is its own code.** A thrown `fetch` becomes `ApiError(0, "NETWORK_ERROR", …)`
  with a message that mentions free-tier cold starts.
- **`handleUnauthorized` clears the token and does a full `window.location.assign("/login")`**
  (skipped when already on `/login` or `/signup`). It is a module, not a component, so no
  router is available; a full navigation is intentional — it discards all in-memory state for
  the session that just became unauthenticated. The one `eslint-disable` in the codebase sits
  here (`@next/next/no-location-assign-relative-destination`).

The `api` object groups the endpoints:

```ts
export const api = {
  auth: {
    signup(input) { return request<AuthResponse>("/api/auth/signup", { method: "POST", body: input, auth: false, redirectOn401: false }); },
    login(input)  { return request<AuthResponse>("/api/auth/login",  { method: "POST", body: input, auth: false, redirectOn401: false }); },
    async me()    { const { user } = await request<{ user: User }>("/api/auth/me"); return user; },
  },
  campaigns: {
    async create(input) { const { campaign } = await request<{ campaign: Campaign }>("/api/campaigns", { method: "POST", body: input }); return campaign; },
    mine()          { return request<ItemsResponse<Campaign>>("/api/campaigns/mine"); },
    list(page = 1, limit = 20) { return request<CampaignListResponse>(`/api/campaigns?page=${page}&limit=${limit}`); },
    async get(id)   { const { campaign } = await request<{ campaign: Campaign }>(`/api/campaigns/${id}`); return campaign; },
    submissions(id) { return request<ItemsResponse<Submission>>(`/api/campaigns/${id}/submissions`); },
  },
  submissions: {
    async create(input) { const { submission } = await request<{ submission: Submission }>("/api/submissions", { method: "POST", body: input }); return submission; },
    mine() { return request<ItemsResponse<Submission>>("/api/submissions/mine"); },
    updateViews(id, views) {
      return request<UpdateViewsResponse>(`/api/submissions/${id}/views`, {
        method: "PATCH", body: { views }, auth: false, redirectOn401: false,
      });
    },
  },
  creators: {
    async earnings() { const { earnings } = await request<{ earnings: Earnings }>("/api/creators/me/earnings"); return earnings; },
  },
};
```

- **Login and signup set `auth: false, redirectOn401: false`** so a wrong password shows an
  inline error instead of bouncing the user to `/login`.
- **`updateViews` is public (D13)** — no `Authorization` header, no redirect on 401.
- **The envelope is unwrapped at the edge.** Callers get the inner object (`Campaign`,
  `Submission`, `Earnings`), not `{ campaign }` / `{ items }`, so components never reach into
  a wrapper.

## Deep dive — `frontend/src/lib/authStorage.ts`

```ts
const TOKEN_KEY = "memed_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
}
export function clearToken(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* already unreachable */ }
}
```

- **SSR-safe by construction.** During server rendering `window` is `undefined`, so reads
  return `null` and writes are no-ops — the token is never touched on the server (D16).
- **Every access is wrapped in `try/catch`** because `localStorage` throws in private-mode /
  blocked-cookie environments; the session simply does not persist across reloads there.
- **One key, `memed_token`**, shared by `api.ts` (reads it for the bearer header) and
  `AuthContext` (writes/clears it).

## Deep dive — `frontend/src/context/AuthContext.tsx`

```ts
export interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => void;
}
```

The provider:

```tsx
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init(): Promise<void> {
      const stored = getToken();
      if (stored === null) { if (!cancelled) setLoading(false); return; }
      setTokenState(stored);
      try {
        const me = await api.auth.me();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) { clearToken(); setTokenState(null); setUser(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await api.auth.login({ email, password });
    setToken(result.token); setTokenState(result.token); setUser(result.user);
    return result.user;
  }, []);

  const signup = useCallback(async (input) => {
    const result = await api.auth.signup(input);
    setToken(result.token); setTokenState(result.token); setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(() => { clearToken(); setTokenState(null); setUser(null); }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, signup, logout }),
    [user, token, loading, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error("useAuth must be used inside an <AuthProvider>.");
  return context;
}
```

- **Hydration safety is the whole point of the initial state.** `user: null`, `token: null`,
  `loading: true` are identical on the server and on the first client render; `localStorage`
  is only read inside `useEffect`, never during render. That is why the app never throws a
  hydration mismatch on the auth state.
- **`loading` starts `true` and only flips in the effect.** With no stored token it flips
  immediately (nothing to verify); with a token it stays `true` until `/api/auth/me` resolves.
  Guards and pages key off `loading` to avoid a flash of the wrong screen.
- **A failed `me()` means a dead token.** The catch clears storage and stays logged out
  rather than leaving a half-authenticated state.
- **`login`/`signup` persist the token and set the user in one step**, then return the user so
  the caller can route by role.
- **`useAuth` throws outside a provider** — a loud failure beats a silent `undefined`.

## Deep dive — `frontend/src/components/ProtectedRoute.tsx`

```tsx
function dashboardFor(role: Role): string { return role === "brand" ? "/brand" : "/creator"; }

export default function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user === null) { router.replace("/login"); return; }
    if (user.role !== role) router.replace(dashboardFor(user.role));
  }, [loading, user, role, router]);

  if (loading || user === null || user.role !== role) {
    return <div id="main-content" className="container gate"><Spinner /></div>;
  }
  return <>{children}</>;
}
```

- **Redirects happen in an effect, never during render** — `router.replace` is a side effect.
- **Three states render the spinner:** still loading, no user, or wrong role. The children
  only mount once the user is present *and* the role matches, so a brand never sees the
  creator dashboard even for a frame.
- **Wrong role goes to that user's own dashboard**, not to `/login` — a signed-in creator who
  hits `/brand` lands on `/creator`.

## Deep dive — `frontend/src/app/layout.tsx`

```tsx
import { Space_Grotesk, Plus_Jakarta_Sans } from "next/font/google";

const display = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-display" });
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Meme'd",
  description: "Meme'd — a creator marketplace where brands run campaigns and creators get paid per milestone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- **Two fonts from `next/font/google`** (bundled with Next — no extra dependency): Space
  Grotesk is the bold display face for headings and big numbers, Plus Jakarta Sans is the body
  face. They are exposed as CSS variables (`--font-display`, `--font-sans`) consumed by
  `globals.css`.
- **The skip link is the first focusable element** and targets `#main-content`, which every
  page's `<main>` carries. `globals.css` keeps it off-screen until focused.
- **`AuthProvider` wraps everything**, so `useAuth` works on every page.
- **`LayoutProps<"/">`** is the Next 16 typed-layout helper (no manual `{ children }` type).

## Deep dive — `frontend/src/app/page.tsx`

```tsx
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user === null) { router.replace("/login"); return; }
    router.replace(user.role === "brand" ? "/brand" : "/creator");
  }, [loading, user, router]);

  return <main id="main-content" className="container gate"><Spinner /></main>;
}
```

- **The entry point is a pure redirector.** Not logged in → `/login`; brand → `/brand`;
  creator → `/creator`. It renders a centred spinner while the auth state resolves.

## Deep dive — `frontend/src/app/login/page.tsx` and `signup/page.tsx`

Both pages share the same skeleton: local field state, a `validate()` pass, a submit handler
that calls `login`/`signup`, inline server errors, and a redirect to the role's dashboard.

```tsx
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function dashboardFor(role: Role): string { return role === "brand" ? "/brand" : "/creator"; }

// Already signed in: go straight to the right dashboard.
useEffect(() => {
  if (!loading && user !== null) router.replace(dashboardFor(user.role));
}, [loading, user, router]);

async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  setFormError(null); setDetails([]);
  if (!validate()) return;
  setSubmitting(true);
  try {
    const signedIn = await login(email.trim(), password);
    router.replace(dashboardFor(signedIn.role));
  } catch (error) {
    if (error instanceof ApiError) {
      setFormError(error.message);
      if (error.code === "VALIDATION_ERROR" && error.details !== undefined) setDetails(error.details);
    } else {
      setFormError("Something went wrong. Please try again.");
    }
  } finally {
    setSubmitting(false);
  }
}
```

- **Client validation mirrors the server** (email shape, required fields, password ≥ 8) but
  the server is still the authority — a `VALIDATION_ERROR` response renders its `details` as a
  `path: message` list under the form.
- **`noValidate` on the form** turns off the browser's native bubbles so the app's own
  messages are the only ones shown.
- **`aria-invalid` + `aria-describedby`** wire each field to its error paragraph.
- **Signup adds a role selector** as two large radio cards (`role-card`), with **no default** —
  the user must choose explicitly because the role is permanent (D17). The radios are
  `visually-hidden`; the visible card is the label, and `.is-selected` styles the chosen one.
- **The password field carries a persistent hint** (`at least 8 characters`) via
  `aria-describedby="password-hint password-error"`.
- **Both pages render a centred spinner while `loading`** so a signed-in user never sees the
  login form flash before the redirect.
- **The wordmark uses `Meme&apos;d`** — the apostrophe is escaped because
  `react/no-unescaped-entities` is active.

## Deep dive — `frontend/src/components/AppShell.tsx`

```tsx
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout(): void { logout(); router.replace("/login"); }

  const home = user === null ? "/" : user.role === "brand" ? "/brand" : "/creator";

  return (
    <>
      <header className="app-header">
        <div className="container app-header-inner">
          <Link href={home} className="app-brand">Meme&apos;d</Link>
          {user !== null && (
            <div className="app-user">
              <span className="app-user-name">{user.name}</span>
              <span className={`badge ${user.role === "brand" ? "badge-accent" : "badge-gray"}`}>
                {user.role === "brand" ? "Brand" : "Creator"}
              </span>
              <button type="button" className="secondary" onClick={handleLogout}>Log out</button>
            </div>
          )}
        </div>
      </header>
      <main id="main-content" className="container app-main">{children}</main>
    </>
  );
}
```

- **The signed-in chrome shared by both dashboards:** a sticky top bar with the wordmark, the
  user's name, a role badge and a logout button, then the page content in the wide container.
- **The wordmark links to the user's own dashboard** (`home`), so it is a safe "go home".
- **Logout clears the token and routes to `/login`** in one click.
- **`<main id="main-content">`** is the skip-link target for every dashboard page.

## Deep dive — `frontend/src/app/brand/page.tsx`

```tsx
export default function BrandDashboardPage() {
  return (
    <ProtectedRoute role="brand">
      <AppShell><BrandDashboard /></AppShell>
    </ProtectedRoute>
  );
}

function BrandDashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setError(null);
      try {
        const result = await api.campaigns.mine();
        if (!cancelled) setCampaigns(result.items);
      } catch (err) { if (!cancelled) setError(err); }
    }
    void load();
    return () => { cancelled = true; };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  // … PageHeader, CreateCampaignForm onCreated={reload}, then the campaign list
}
```

- **The page is a thin composition:** `ProtectedRoute role="brand"` → `AppShell` →
  `PageHeader` + `CreateCampaignForm` + the campaign list.
- **`reloadToken` is the refresh idiom used throughout the app.** A child calls `reload()`,
  which bumps the token; the effect depends on it and re-fetches. No global store needed.
- **Three render states for the list:** error → `ErrorMessage`; `null` → two
  `CampaignCardSkeleton`s plus a visually-hidden `role="status"` "Loading campaigns…"; empty →
  `EmptyState`; otherwise one `BrandCampaignCard` per campaign.
- **The `cancelled` flag** stops a late response from setting state after unmount.

## Deep dive — `frontend/src/components/CreateCampaignForm.tsx`

The brand's create-campaign form: name, platform, budget, dynamic milestone rows, a live
ladder preview, and client validation that mirrors D8/D9.

```tsx
const EMPTY_ROW: MilestoneRow = { views: "", payout: "" };
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

function emptyForm(): CampaignFormValues {
  return { name: "", platform: "", budget: "", milestones: [{ ...EMPTY_ROW }] };
}

function parsePositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function previewLadder(rows: MilestoneRow[]): Milestone[] {
  const parsed: Milestone[] = [];
  for (const row of rows) {
    const views = parsePositive(row.views);
    const payout = parsePositive(row.payout);
    if (views !== null && payout !== null) parsed.push({ views, payout });
  }
  return parsed.sort((a, b) => a.views - b.views);
}
```

Submit:

```tsx
async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  setSubmitError(null); setSuccess(false);

  const result = validateCampaignForm(values);
  if (!result.valid || result.input === undefined) { setErrors(result.errors); return; }

  setErrors(null); setSubmitting(true);
  try {
    await api.campaigns.create(result.input);
    setValues(emptyForm()); setSuccess(true); onCreated();
  } catch (err) { setSubmitError(err); }
  finally { setSubmitting(false); }
}
```

- **All validation lives in `lib/campaignValidation.ts`** (see below); this component only
  renders the returned `errors` and submits the returned `input`. The form never re-implements
  a rule.
- **Row add/remove is bounded** by `MIN_MILESTONES`/`MAX_MILESTONES` (1–20); the Remove button
  is disabled at the minimum and Add at the maximum.
- **The live preview is display-only.** `previewLadder` parses whatever rows currently parse
  cleanly, sorts them ascending, and renders `10K views → ₹500` chips. It never affects what is
  submitted — the server still validates the real payload.
- **On success the form resets and calls `onCreated()`**, which bumps the parent's reload token
  so the new campaign appears immediately.
- **Server errors render through `ErrorMessage`**, so a `VALIDATION_ERROR` with
  `milestones.1.views` details shows the exact field path.

## Deep dive — `frontend/src/lib/campaignValidation.ts`

Pure, framework-free validation mirroring D8 (milestone ladder) and D9 (budget). No React, no
DOM — safe to unit test in isolation.

```ts
export const MIN_MILESTONES = 1;
export const MAX_MILESTONES = 20;
export const MAX_NAME_LENGTH = 120;

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function validateCampaignForm(values: CampaignFormValues): CampaignFormValidation {
  const errors: CampaignFormErrors = { rows: values.milestones.map(() => ({})) };
  let hasError = false;

  const name = values.name.trim();
  if (name.length === 0) { errors.name = "Name is required"; hasError = true; }
  else if (name.length > MAX_NAME_LENGTH) { errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters`; hasError = true; }

  const platform = values.platform;
  if (platform !== "instagram" && platform !== "youtube") { errors.platform = "Choose a platform"; hasError = true; }

  const budget = parsePositiveInteger(values.budget);
  if (budget === null) { errors.budget = "Budget must be a positive integer"; hasError = true; }

  const rowCount = values.milestones.length;
  if (rowCount < MIN_MILESTONES || rowCount > MAX_MILESTONES) {
    errors.milestones = `Milestones must contain between ${MIN_MILESTONES} and ${MAX_MILESTONES} entries`;
    hasError = true;
  }

  const parsed: { views: number; payout: number }[] = [];
  values.milestones.forEach((row, index) => {
    const views = parsePositiveInteger(row.views);
    const payout = parsePositiveInteger(row.payout);
    if (views === null) { errors.rows[index].views = "Views must be a positive integer"; hasError = true; }
    if (payout === null) { errors.rows[index].payout = "Payout must be a positive integer"; hasError = true; }
    if (views !== null && payout !== null) parsed.push({ views, payout });
  });

  if (hasError) return { errors, valid: false };

  const ordered = parsed
    .map((row, index) => ({ views: row.views, payout: row.payout, index }))
    .sort((a, b) => a.views - b.views);

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (current.views <= previous.views) { errors.rows[current.index].views = "Milestone views must be strictly increasing"; hasError = true; }
    if (current.payout <= previous.payout) { errors.rows[current.index].payout = "Milestone payout must be strictly increasing"; hasError = true; }
  }

  let lowestPayout = Number.POSITIVE_INFINITY;
  for (const row of ordered) lowestPayout = Math.min(lowestPayout, row.payout);
  if (budget !== null && budget < lowestPayout) { errors.budget = "Budget must be at least the smallest milestone payout"; hasError = true; }

  if (hasError || budget === null || (platform !== "instagram" && platform !== "youtube")) return { errors, valid: false };

  return {
    errors, valid: true,
    input: { name, platform, budget, milestones: ordered.map((row) => ({ views: row.views, payout: row.payout })) },
  };
}
```

- **`/^\d+$/` before `Number()`** rejects `""`, `"1e3"`, `"12abc"`, `"1.5"`, `"-5"`, `"+5"`
  rather than silently coercing them.
- **The ladder is validated after sorting ascending by `views`**, so an unsorted but valid
  ladder is accepted and returned sorted. Errors are written back to the **original row index**
  (`current.index`) so the message points at the row the user actually typed.
- **`errors.rows` always has one entry per submitted row**, in the original order, so the form
  can index it directly.
- **`input` is present only when `valid` is true** — the caller checks `result.input === undefined`.
- **The module's header comment lists eight worked examples** (valid single, unsorted ladder,
  blank name, long name, no platform, bad budget, duplicate thresholds, budget below smallest
  payout) that were verified against the module.

## Deep dive — `frontend/src/lib/format.ts`

```ts
const inrFormatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat("en-IN");

export function formatINR(n: number): string { return inrFormatter.format(n); }      // 5000 -> "₹5,000"
export function formatNumber(n: number): string { return numberFormatter.format(n); } // 100000 -> "1,00,000"

function trimDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatCompactViews(n: number): string {
  if (n >= 10_000_000) return `${trimDecimal(n / 10_000_000)}Cr`;
  if (n >= 100_000) return `${trimDecimal(n / 100_000)}L`;
  if (n >= 1_000) return `${trimDecimal(n / 1_000)}K`;
  return String(n);
}
```

- **`formatINR` is the D1 money formatter** — `en-IN` grouping, no decimals, used by `Money`.
- **`formatNumber` is the plain `en-IN` grouping** for view counts in tables.
- **`formatCompactViews` is display-only** for the ladder preview and chips: `10000 → "10K"`,
  `250000 → "2.5L"`, `12000000 → "1.2Cr"`. `trimDecimal` drops a trailing `.0` so `1.0 → "1"`.

## Deep dive — `frontend/src/components/Money.tsx`, `MilestoneLadder.tsx`, `StatusBadge.tsx`, `ProgressBar.tsx`

Four small presentational components.

```tsx
// Money.tsx — renders an integer rupee amount with en-IN grouping (D1).
export default function Money({ value }: { value: number }) { return <>{formatINR(value)}</>; }
```

```tsx
// MilestoneLadder.tsx — the ladder as a vertical stepper, ascending by views.
export default function MilestoneLadder({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return <p className="muted">No milestones.</p>;
  const ordered = [...milestones].sort((a, b) => a.views - b.views);
  return (
    <ol className="ladder">
      {ordered.map((milestone, index) => (
        <li className="ladder-step" key={`${milestone.views}:${milestone.payout}`}>
          <span className="ladder-node" aria-hidden="true">{index + 1}</span>
          <span className="ladder-body">
            <span className="ladder-views">{formatNumber(milestone.views)} views</span>
            <span className="ladder-arrow" aria-hidden="true">→</span>
            <span className="ladder-payout"><Money value={milestone.payout} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}
```

```tsx
// StatusBadge.tsx — live -> green, exhausted -> red.
export default function StatusBadge({ status }: { status: CampaignStatus }) {
  const live = status === "live";
  return <span className={`badge ${live ? "badge-green" : "badge-red"}`}>{live ? "Live" : "Exhausted"}</span>;
}
```

```tsx
// ProgressBar.tsx — budget usage; colour by percent used (display only).
export default function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const rounded = Math.round(percent);
  const exhausted = rounded >= 100;
  let stateClass = "";
  if (exhausted) stateClass = "is-exhausted";
  else if (rounded >= 90) stateClass = "is-danger";
  else if (rounded >= 70) stateClass = "is-warn";
  return (
    <div className="progress-wrap">
      <div className="progress" role="progressbar" aria-valuenow={rounded} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${rounded}% used`}>
        <div className={`progress-fill ${stateClass}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-label">
        <span className="muted">{rounded}% used</span>
        {exhausted && <span className="badge badge-red">Budget exhausted</span>}
      </p>
    </div>
  );
}
```

- **`Money` is the only place money is formatted** — every amount in the UI goes through it.
- **`MilestoneLadder` sorts defensively** (the backend already returns ascending) and keys by
  `views:payout` so duplicate thresholds would not collide.
- **`ProgressBar` clamps to 0–100 and guards `max <= 0`** (no divide-by-zero), and drives its
  colour purely from percent used: `<70%` accent, `70–89%` amber, `≥90%` red, `100%` red with a
  hatched "exhausted" fill and a "Budget exhausted" badge. It exposes proper
  `role="progressbar"` ARIA values.

## Deep dive — `frontend/src/components/BrandCampaignCard.tsx`

One campaign card on the brand dashboard: platform pill, status badge, a Spent/Remaining/Budget
block, the progress bar, the milestone ladder, and a toggle that lazily loads that campaign's
submissions.

```tsx
const PLATFORM_LABEL: Record<Campaign["platform"], string> = { instagram: "Instagram", youtube: "YouTube" };
const SUBMISSION_COLUMNS = ["Creator", "Post", "Views", "Paid", "Status"];

export default function BrandCampaignCard({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submissionCount = campaign.submissionCount ?? 0;

  async function loadSubmissions(): Promise<void> {
    setLoading(true); setError(null);
    try { const result = await api.campaigns.submissions(campaign.id); setSubmissions(result.items); }
    catch (err) { setError(err); }
    finally { setLoading(false); }
  }

  function handleToggle(): void {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (submissions === null) void loadSubmissions();  // lazy: fetch on first expand only
  }
  // … card markup
}
```

- **Submissions load lazily on first expand** and are cached in component state; a Refresh
  button re-fetches them. Collapsing does not discard them.
- **The budget block shows Spent and Remaining as big display numbers** and Budget as a muted
  total; `ProgressBar value={campaign.spent} max={campaign.budget}` sits under it.
- **The submissions table** shows creator, post link (`target="_blank" rel="noopener noreferrer"`
  plus a visually-hidden "(opens in a new tab)"), views, paid, and a Status cell with `Capped`
  (yellow) and `Flagged` (red, `title={flagReason}`) badges.
- **Loading/empty/error states** for the submissions panel: `SubmissionsSkeleton` while
  loading, `EmptyState` when empty, `ErrorMessage` on failure.

## Deep dive — `frontend/src/app/creator/page.tsx`

```tsx
export default function CreatorDashboardPage() {
  return (
    <ProtectedRoute role="creator">
      <AppShell><CreatorDashboard /></AppShell>
    </ProtectedRoute>
  );
}

function CreatorDashboard() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [earningsError, setEarningsError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setEarningsError(null);
      try { const result = await api.creators.earnings(); if (!cancelled) setEarnings(result); }
      catch (err) { if (!cancelled) setEarningsError(err); }
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshToken]);

  const refreshAll = useCallback(() => setRefreshToken((t) => t + 1), []);
  // … earnings hero, then <CreatorCampaignList refreshToken onRefresh={refreshAll} /> and <MySubmissions … />
}
```

- **One `refreshAll()` re-fetches everything the page shows** — earnings, the campaign page
  currently displayed, and the submissions — because both children take `refreshToken` and
  call `onRefresh` after a successful write.
- **The earnings hero** shows the total as a big display number, a "N submissions across M
  campaigns" line, a hint when there are none, and a per-campaign breakdown list.
- **Loading/error states** for earnings: `EarningsSkeleton` while loading, `ErrorMessage` on
  failure.

## Deep dive — `frontend/src/components/CreatorCampaignList.tsx`

The live-campaign browser: paginated cards, each with a submit-post form.

```tsx
const PAGE_SIZE = 10;

useEffect(() => {
  let cancelled = false;
  async function load(): Promise<void> {
    setLoading(true); setError(null);
    try {
      const result = await api.campaigns.list(page, PAGE_SIZE);
      if (cancelled) return;
      const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
      if (page > totalPages) { setPage(totalPages); return; }  // page vanished; step back
      setData(result);
    } catch (err) { if (!cancelled) setError(err); }
    finally { if (!cancelled) setLoading(false); }
  }
  void load();
  return () => { cancelled = true; };
}, [page, refreshToken]);
```

- **Pagination is Prev/Next** with a "Page X of Y" label; the buttons disable at the ends.
- **The "step back to a valid page" guard** handles the case where the current page becomes
  empty after a refresh (e.g. campaigns were exhausted and dropped out of `listLive`): it sets
  `page` to the last valid page and lets the effect re-fetch.
- **Each card** shows the campaign name, brand, platform badge, status badge, remaining budget,
  the milestone ladder, and a `SubmitPostForm`.
- **Loading/empty/error states:** two `CampaignCardSkeleton`s while loading, `EmptyState` when
  there are no live campaigns, `ErrorMessage` on failure.

## Deep dive — `frontend/src/components/SubmitPostForm.tsx`

One submit-post form per campaign card; each instance owns its own state.

```tsx
const PLACEHOLDER: Record<Campaign["platform"], string> = {
  instagram: "https://www.instagram.com/p/ABC123xyz",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  const trimmed = postUrl.trim();
  if (trimmed === "") { setClientError("Enter a post URL."); setSubmitted(false); return; }

  setClientError(null); setError(null); setSubmitted(false); setSubmitting(true);
  try {
    await api.submissions.create({ campaignId: campaign.id, postUrl: trimmed });
    setPostUrl(""); setSubmitted(true); onSubmitted();
  } catch (err) { setError(err); }
  finally { setSubmitting(false); }
}
```

- **The server validates the URL against the campaign's platform and rejects duplicates**;
  those messages render under this form only (via `ErrorMessage`), so forms on different cards
  never share anything.
- **The placeholder is platform-aware** (an Instagram or YouTube example URL).
- **On success the input clears, a "Post submitted" line appears, and `onSubmitted()` fires**
  so the page re-fetches earnings, the campaign list and the submissions.

## Deep dive — `frontend/src/components/MySubmissions.tsx`

The creator's own submissions, newest first, with a per-row demo control that simulates
platform view data.

```tsx
const MAX_VIEWS = 2_000_000_000;   // spec §5.4
const INTEGER_PATTERN = /^\d+$/;
const RESULT_TIMEOUT_MS = 4000;

async function handleUpdate(): Promise<void> {
  const trimmed = views.trim();
  if (!INTEGER_PATTERN.test(trimmed)) { setClientError("Enter a whole number of views."); setResult(null); return; }
  const value = Number(trimmed);
  if (value > MAX_VIEWS) { setClientError(`Views must be between 0 and ${formatNumber(MAX_VIEWS)}.`); setResult(null); return; }

  setClientError(null); setError(null); setResult(null); setUpdating(true);
  try {
    const response = await api.submissions.updateViews(submission.id, value);
    const { payout } = response;
    if (payout.capped) {
      showResult("warn", payout.delta > 0 ? `Paid +${formatINR(payout.delta)} · budget ran out (capped)` : "Budget ran out — capped");
    } else if (payout.delta > 0) {
      showResult("ok", `Paid +${formatINR(payout.delta)}`);
    } else {
      showResult("muted", "No new payout");
    }
    onRefresh();
  } catch (err) { setError(err); }
  finally { setUpdating(false); }
}
```

- **Each row owns its own input/result state** (keyed by submission id), so a refresh never
  mixes rows up.
- **The payout chip auto-dismisses** after 4s; the effect depends on `result`, which is a fresh
  object on every update, so the timer resets each time. `resultKey` bumps so the chip remounts
  and its fade-in replays.
- **The chip has three tones** driven by the response: `ok` (`Paid +₹X`), `muted` (`No new
  payout`), `warn` (capped — with or without a partial delta).
- **Client validation mirrors the API bounds** (`0..2_000_000_000`, whole numbers) before the
  request; server errors still render through `ErrorMessage`.
- **The table collapses into stacked cards on narrow screens** via `data-label` attributes and
  the `.submissions-table` media query in `globals.css`.
- **A "Demo: simulate platform data" strip** labels the control clearly (spec §7 Phase 7 task 5).

## Deep dive — `frontend/src/components/ErrorMessage.tsx`, `EmptyState.tsx`, `Spinner.tsx`, `Skeleton.tsx`, `PageHeader.tsx`

The shared state primitives.

```tsx
// ErrorMessage.tsx — an ApiError shows its message + field details; anything else is generic.
export default function ErrorMessage({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    return (
      <div className="error" role="alert">
        <p>{error.message}</p>
        {error.details !== undefined && error.details.length > 0 && (
          <ul>{error.details.map((d) => <li key={`${d.path}:${d.message}`}>{d.path}: {d.message}</li>)}</ul>
        )}
      </div>
    );
  }
  return <div className="error" role="alert"><p>Something went wrong</p></div>;
}
```

```tsx
// EmptyState.tsx — a friendly placeholder with an optional action.
export default function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true" />
      <p className="empty-state-title">{title}</p>
      {description !== undefined && <p className="empty-state-desc">{description}</p>}
      {action !== undefined && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
```

```tsx
// Spinner.tsx — minimal loading placeholder.
export default function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </div>
  );
}
```

```tsx
// Skeleton.tsx — a shimmering block; decorative, hidden from assistive tech.
export default function Skeleton({ width = "100%", height = "1rem", radius, className }: { … }) {
  return <span className={className === undefined ? "skeleton" : `skeleton ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
```

```tsx
// PageHeader.tsx — a title plus a one-line subtitle, shared by both dashboards.
export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {subtitle !== undefined && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}
```

- **`ErrorMessage` is the single error renderer** — it understands `ApiError` and falls back to
  a generic message for anything else, always with `role="alert"`.
- **Skeletons are `aria-hidden`**; the surrounding region announces loading with a
  visually-hidden `role="status"` message, so screen readers hear "Loading…" once, not a pile
  of decorative blocks.

## Deep dive — `frontend/src/components/CampaignCardSkeleton.tsx`, `EarningsSkeleton.tsx`, `SubmissionsSkeleton.tsx`

Composed skeletons that mirror the real layouts.

- **`CampaignCardSkeleton`** reuses the real card classes (`.card`, `.campaign-head`,
  `.budget-block`, `.skeleton-bar`, `.skeleton-ladder`) so it has the exact shape of a campaign
  card — title, meta, budget stats, progress bar, ladder — while the list loads.
- **`EarningsSkeleton`** mirrors the earnings hero: a small eyebrow, a big total, a sub line,
  and a two-row breakdown.
- **`SubmissionsSkeleton`** takes the real `columns` array and renders placeholder rows using
  the real table classes, so it collapses into stacked cards on narrow screens exactly like the
  loaded table does.

## Deep dive — `frontend/src/app/globals.css`

One stylesheet, ~1650 lines, organised into 22 numbered sections. Dark-first with a
`prefers-color-scheme: light` override; every colour, radius, spacing and shadow is a CSS
variable in `:root`.

```css
:root {
  color-scheme: dark;
  --accent: #c8ff3e;          /* electric lime — primary actions, progress, key numbers */
  --accent-hover: #d7ff6b;
  --accent-press: #b6ef2a;
  --accent-ink: #0a0b0f;      /* text on an accent fill */
  --accent-text: #c8ff3e;     /* accent as text on the page background */
  --accent-soft: rgba(200, 255, 62, 0.12);
  --accent-border: rgba(200, 255, 62, 0.32);

  --bg: #0a0b0f; --bg-elev: #10121a; --surface: #14161f; --surface-2: #1b1e2a;
  --border: #262a38; --border-strong: #343a4d;
  --text: #f4f6fb; --muted: #9aa3b4; --faint: #7a8395;

  --radius-sm: 8px; --radius-control: 10px; --radius: 14px; --radius-lg: 20px; --radius-pill: 999px;
  --space-1: 4px; … --space-8: 64px;
  --shadow-sm: …; --shadow-md: …; --shadow-lg: …; --glow-accent: …;
  --dur-fast: 120ms; --dur: 200ms; --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --maxw: 1100px;
  --ring: var(--accent);
}
```

The 22 sections:

1. **Tokens** — `:root` (dark) + light-mode overrides.
2. **Base** — reset, typography, links, focus, selection, `.display` numerals.
3. **Layout helpers** — `.container`, `.row`, `.row-between`, `.stack`, `.inline-field`, `.two-col`.
4. **Buttons** — primary (accent), `.secondary`, `.link`, disabled/loading states.
5. **Forms** — inputs/selects/textarea, labels, fieldsets, `.hint`, `.field`.
6. **Cards** — `.card`, `.card-title`.
7. **Badges & pills** — `.badge` + `-green/-yellow/-red/-gray/-accent`, `.pill`.
8. **Progress** — `.progress`, `.progress-fill` + `is-warn/is-danger`.
9. **Tables** — `.table-wrap`, sticky headers, `.simulate-views`, `.submit-post-form`.
10. **Messages** — `.error`, `.success`.
11. **Skeleton & spinner** — `.skeleton` shimmer, `.spinner`.
12. **Header chrome** — `.app-header`, `.app-brand`.
13. **Utilities** — `.visually-hidden`, `.milestone-ladder`, `.breakdown`.
14. **Motion preferences** — `prefers-reduced-motion` kills animation/transition.
15. **Mobile** — container/card padding and font-size at ≤480px.
16. **App shell** — `.app-main`, `.app-user`, `.app-user-name`.
17. **Page header** — `.page-header`, `.page-title`, `.page-subtitle`.
18. **Auth pages** — `.auth-page` (radial glow + masked grid), `.auth-panel`, `.role-card`.
19. **Brand dashboard** — `.progress-wrap`, `.budget-block`, `.ladder` stepper, `.form-grid`,
    `.milestone-row`, `.ladder-preview`.
20. **Creator dashboard** — `.eyebrow`, `.earnings-hero`, `.campaign-remaining`, `.demo-strip`,
    `.result-chip`, and the submissions table→cards media query.
21. **Loading, empty states & motion** — `.skeleton-stack`, `.empty-state`, `.gate`, `rise-in`.
22. **Accessibility & mobile pass** — `.skip-link`, `#main-content` scroll margin, 44px tap
    targets, header name truncation.

- **One accent, used sparingly.** Electric lime marks primary actions, progress and key
  numbers; everything else is neutral surfaces and borders.
- **Light mode is opt-in** via `prefers-color-scheme: light` and keeps WCAG AA contrast.
- **Focus is always visible** (`:focus-visible` outline) but mouse focus stays quiet.
- **`prefers-reduced-motion` disables** the shimmer, spinner, chip fade and card rise-in.
- **The submissions table becomes stacked cards at ≤720px** using `data-label` pseudo-elements,
  and the milestone rows reflow at ≤560px.

---

## The tests

The frontend has **no automated test runner** (no jest/vitest — `package.json` has only
`next`, `react`, `react-dom` and the create-next-app devDependencies). Verification was done
with the toolchain plus a live end-to-end run against the real backend.

**Static checks (all clean):**

- `npm run build` — exit 0; 8 static routes including `/brand` and `/creator`.
- `npm run lint` — exit 0; `npx eslint . --max-warnings=0` → 27 files, 0 errors / 0 warnings.
- `npx tsc --noEmit` — exit 0.
- No `console.log`; no `any`; both post links carry `target="_blank" rel="noopener noreferrer"`;
  no new dependencies; `.env.local` is git-ignored and `.env.example` is correct; `git diff
  --stat backend/` is empty (the backend is untouched).

**End-to-end run over HTTP (the exact API the UI calls):**

- Submit a post → `201`.
- Simulate views `10000` → pays `₹500`; `50000` → pays `₹2000`; `20000` (a decrease) → stores
  the count, pays `delta 0` (high-water entitlement, D5).
- Campaign remaining budget `5000 → 4500 → 3000`; creator earnings `₹2,000`, `submissionCount 1`.
- Error paths: wrong platform → `400 "URL host is not an Instagram host"`; duplicate → `409
  "This post has already been submitted"`; malformed URL → `400 "URL is missing or malformed"`;
  `views > 2_000_000_000` → `400`.

**Manual QA (spec §7 Phase 7 exit criteria):** brand signs up → creates a campaign → creator
signs up → submits a post → simulates views → earnings and brand spent/remaining update. The
mobile layout was verified statically (360px is safe: `box-sizing: border-box`, no fixed
container width, `.table-wrap { overflow-x: auto }`, flex rows wrap, the ≤480px media query).

---

## How to change things in Phase 7

| You want to… | Do this |
|---|---|
| Point the app at a different backend | `frontend/.env.local` → `NEXT_PUBLIC_API_URL` (restart the dev server). |
| Add or change an endpoint | `src/lib/api.ts` → the `api` object (and `src/types/api.ts` for its shape). |
| Change the error envelope handling | `src/lib/api.ts` → `toApiError` / `toDetails`. |
| Change the 401 behaviour | `src/lib/api.ts` → `handleUnauthorized` (and the `redirectOn401` option). |
| Change the token key or storage | `src/lib/authStorage.ts` → `TOKEN_KEY` (D16). |
| Change auth state or the `me()` bootstrap | `src/context/AuthContext.tsx` → `AuthProvider`. |
| Change who can see a page | `src/components/ProtectedRoute.tsx` → the `role` prop on each page. |
| Change the create-campaign rules | `src/lib/campaignValidation.ts` → `validateCampaignForm` (mirror D8/D9). |
| Change the milestone row limits | `src/lib/campaignValidation.ts` → `MIN_MILESTONES` / `MAX_MILESTONES`. |
| Change the ladder preview | `src/components/CreateCampaignForm.tsx` → `previewLadder` (display only). |
| Change money or number formatting | `src/lib/format.ts` → `formatINR` / `formatNumber` / `formatCompactViews`. |
| Change the max simulated views | `src/components/MySubmissions.tsx` → `MAX_VIEWS` (keep it equal to the API's `2_000_000_000`). |
| Change the payout chip behaviour | `src/components/MySubmissions.tsx` → `handleUpdate` / `RESULT_TIMEOUT_MS`. |
| Change the budget bar colours | `src/components/ProgressBar.tsx` → the `rounded >= 70/90/100` thresholds. |
| Change the theme | `src/app/globals.css` → the `:root` tokens (and the light-mode block). |
| Change the fonts | `src/app/layout.tsx` → the `next/font/google` imports. |
| Change the page size | `src/components/CreatorCampaignList.tsx` → `PAGE_SIZE`. |

> Rule of thumb: components render and hold local state; `lib/` holds pure logic (validation,
> formatting, the fetch client); `context/` holds cross-page state. Keep the API shapes in
> `types/api.ts` and changes stay local.

---

## How the pieces connect (request flow)

```
Browser
  → layout.tsx (fonts, skip-link, AuthProvider)
      → AuthProvider.init(): getToken() → api.auth.me() → set user / clear dead token
  → page.tsx: loading? spinner : user? role dashboard : /login
  → ProtectedRoute role=…: wrong role → own dashboard; no user → /login
      → AppShell (header + <main id="main-content">)

Brand dashboard (/brand)
  → api.campaigns.mine()            → GET  /api/campaigns/mine
  → CreateCampaignForm
      → validateCampaignForm(values) (client, mirrors D8/D9)
      → api.campaigns.create(input)  → POST /api/campaigns
      → onCreated() → reloadToken++ → re-fetch mine()
  → BrandCampaignCard (per campaign)
      → ProgressBar(spent/budget), MilestoneLadder(milestones)
      → expand → api.campaigns.submissions(id) → GET /api/campaigns/:id/submissions

Creator dashboard (/creator)
  → api.creators.earnings()          → GET  /api/creators/me/earnings
  → CreatorCampaignList
      → api.campaigns.list(page, 10) → GET  /api/campaigns?page&limit
      → SubmitPostForm → api.submissions.create({ campaignId, postUrl })
                                      → POST /api/submissions   (201 / 400 / 409)
      → onSubmitted() → refreshAll() → refreshToken++
  → MySubmissions
      → api.submissions.mine()       → GET  /api/submissions/mine
      → simulate views → api.submissions.updateViews(id, views)
                                      → PATCH /api/submissions/:id/views  (public, D13)
                                      → { submission, payout, campaign } → result chip
      → onRefresh() → refreshAll() → earnings + list + submissions re-fetch

Every request: request<T>() attaches Bearer token, parses JSON, throws ApiError on non-2xx,
and on 401 clears the token and redirects to /login (except login/signup and the public PATCH).
```

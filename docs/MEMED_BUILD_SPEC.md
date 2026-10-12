# Meme'd — Build Specification (Single Source of Truth)

> **How to use this file (instructions to the building agent)**
> 1. This document is authoritative. If anything elsewhere conflicts with it, this file wins.
> 2. Execute the phases **in order**. Do not start a phase until the previous phase's "Exit criteria" pass.
> 3. Make **small, meaningful git commits** at every "Commit checkpoint" using Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`).
> 4. Never invent behaviour that is not specified. Where the brief was open, a decision has been made in **Section 2 (Decision Log)**. Follow it and restate it in the README.
> 5. All money logic lives in **one pure module** (`payout.ts`). No payout arithmetic anywhere else.
> 6. Everything async uses `async/await` with centralized error handling. No unhandled promise rejections, no `any` unless justified in a comment.

---

## 1. Product Overview

**Meme'd** is a creator marketplace. Brands run campaigns; creators (meme pages, clip accounts, hype pages) post content for those campaigns on Instagram or YouTube. Creators are paid through a **milestone ladder**, e.g.:

| Views threshold | Payout |
|---|---|
| 10,000 | ₹500 |
| 50,000 | ₹2,000 |
| 100,000 | ₹5,000 |

**Core rules**
- A post's payout = the payout amount of the **highest milestone its views have reached** (NOT the sum of milestones).
- Total payouts for a campaign must **never exceed** the campaign's budget.

**Deliverable:** A deployed web app where brands create campaigns and creators submit posts and track earnings.

### Tech stack (fixed)
| Layer | Choice |
|---|---|
| Backend | Node.js 20 LTS, TypeScript (strict), Express 4, MongoDB + Mongoose 8 |
| Validation | `zod` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Security | `helmet`, `cors`, `express-rate-limit` |
| Frontend | Next.js (App Router) + TypeScript, minimal CSS (plain CSS modules or a single global stylesheet; no UI framework required) |
| Tests | Jest + `ts-jest`; `supertest` and `mongodb-memory-server` for integration tests |
| Bonus | Redis via `ioredis` (optional at runtime) |
| Package manager | `npm` (commit `package-lock.json`) |
| Deploy | MongoDB Atlas (M0), Render (backend), Vercel (frontend) |

---

## 2. Decision Log (resolves every open point in the brief)

These are final. Implement exactly as written and copy them into the README under "Assumptions".

| # | Topic | Decision |
|---|---|---|
| D1 | **Currency / number type** | All money is stored and computed as **integer rupees** (₹). No floats, no paise. Reject non-integer money input. |
| D2 | **Milestone semantics** | Payout is the amount of the highest milestone with `threshold <= views` (inclusive). Milestones are **not** cumulative. Crossing two milestones in one update pays the **highest** one only (e.g. 0 → 60K views on the example ladder pays ₹2,000, not ₹2,500). |
| D3 | **Paying in increments** | A submission may be paid over time as it climbs. On each update the creator receives the **difference** between what they are now entitled to and what they have already been paid (the "delta"). Total paid to a submission never exceeds the amount of its highest reached milestone. |
| D4 | **Budget runs out mid-payout** | **Partial payout:** the delta is capped at the campaign's remaining budget. Pay what is left, record the submission as `capped`, and mark the campaign `exhausted` when remaining hits 0. Budget is never edited, so a shortfall is never made up later. |
| D5 | **Views decreasing** | The PATCH endpoint accepts any non-negative integer (platforms can correct counts). `views` is stored as given, but **payouts are monotonic**: `entitledAmount` is the high-water mark (`max(previousEntitled, payoutFor(views))`), and there is **no clawback**. A decrease never produces a negative delta. |
| D6 | **Idempotency** | Repeating the same PATCH (same views) results in delta = 0. Money moves only when `entitledAmount` rises above `paidAmount`. |
| D7 | **Concurrency** | Each view update runs inside a **MongoDB transaction** (Atlas M0 and the Docker replica set support this) with retry on transient errors. Concurrent updates can never overspend the budget or double-pay. |
| D8 | **Milestone ladder validation** | 1–20 milestones. `views` and `payout` are positive integers. After sorting ascending by `views`, **both** `views` and `payout` must be **strictly increasing** (no duplicate thresholds; a higher threshold must pay more). Server sorts before storing. |
| D9 | **Budget validation** | `budget` is a positive integer and must be **≥ the smallest milestone payout** (otherwise the campaign can never pay anyone). |
| D10 | **Campaign lifecycle** | Campaign is `live` immediately on creation. Status becomes `exhausted` when `spent === budget`. Only `live` campaigns are listed for creators and accept new submissions. No edit/delete/pause in scope. |
| D11 | **Post URL rules** | URL must be valid `https`/`http`, and match the campaign platform (see Phase 6). It is normalized, and `normalizedUrl` is **globally unique**: the same post cannot be submitted twice, in any campaign (prevents double-paying one post). Ownership of the post cannot be verified (documented limitation). |
| D12 | **Who can submit** | Only users with role `creator`. A creator may submit multiple different posts to the same campaign. |
| D13 | **PATCH views endpoint is public** | `PATCH /api/submissions/:id/views` has **no auth** (simulates platform data, per brief). Document the security implication in the README. |
| D14 | **Earnings** | A creator's total earnings = sum of `paidAmount` across their submissions. |
| D15 | **Spike flag (bonus)** | Flag only; **payouts are not blocked.** See Phase 10 for the exact rule. |
| D16 | **Auth storage (frontend)** | JWT in `localStorage`, sent as `Authorization: Bearer <token>`. (README must note the XSS trade-off vs httpOnly cookies.) |
| D17 | **Roles are chosen at signup** | `role` is `brand` or `creator`; it cannot be changed afterwards. |
| D18 | **IDs in API** | API returns `id` (string), not `_id`/`__v`. Configure Mongoose `toJSON` transform accordingly. |

---

## 3. Repository Layout

```
memed/
├── README.md
├── docs/
│   ├── MEMED_BUILD_SPEC.md      (this file — authoritative)
│   └── PHASE_NOTES.md           # phase-by-phase working notes
├── docker-compose.yml
├── .gitignore
├── backend/
│   ├── package.json  tsconfig.json  jest.config.ts  .env.example  Dockerfile  .dockerignore
│   └── src/
│       ├── app.ts                # builds Express app (no listen) — used by tests
│       ├── server.ts             # connects DB, starts server, graceful shutdown
│       ├── config/               # env.ts (zod-validated env), db.ts, redis.ts
│       ├── domain/               # PURE logic, no I/O
│       │   ├── payout.ts         # calculateEntitledPayout, calculatePayoutDelta
│       │   ├── milestones.ts     # normalize + validate ladder
│       │   ├── spike.ts          # spike detection (bonus)
│       │   └── postUrl.ts        # URL validation + normalization
│       ├── models/               # User.ts, Campaign.ts, Submission.ts
│       ├── services/             # auth, campaign, submission, viewUpdate (transactional)
│       ├── controllers/          # thin HTTP handlers
│       ├── routes/               # auth, campaigns, submissions, creators
│       ├── middleware/           # authenticate, requireRole, validate, errorHandler, notFound, asyncHandler
│       ├── errors/               # AppError + subclasses
│       ├── validators/           # zod schemas
│       └── types/                # shared TS types, express.d.ts augmentation
│   └── tests/
│       ├── unit/                 # payout, milestones, postUrl, spike
│       └── integration/          # auth, campaigns, submissions, views (+ concurrency)
└── frontend/
    ├── package.json  tsconfig.json  next.config.js  .env.example  Dockerfile
    └── src/
        ├── app/                  # layout.tsx, page.tsx, login/, signup/, brand/, creator/
        ├── components/           # forms, tables, ProgressBar, ProtectedRoute, etc.
        ├── context/AuthContext.tsx
        ├── lib/api.ts            # typed fetch client
        └── types/                # mirrors API types
```

---

## 4. Domain Model

### 4.1 `User`
| Field | Type | Notes |
|---|---|---|
| `name` | string | required, trimmed, 1–80 chars |
| `email` | string | required, lowercase, trimmed, **unique index** |
| `passwordHash` | string | bcrypt (cost 10), `select: false`, never returned |
| `role` | `'brand' \| 'creator'` | required |
| `createdAt/updatedAt` | Date | timestamps |

### 4.2 `Campaign`
| Field | Type | Notes |
|---|---|---|
| `brand` | ObjectId → User | required, indexed |
| `name` | string | required, 1–120 chars |
| `platform` | `'instagram' \| 'youtube'` | required |
| `budget` | integer | required, ≥ 1 |
| `spent` | integer | default 0, `0 ≤ spent ≤ budget` |
| `milestones` | `[{ views: int, payout: int }]` | stored ascending, validated per D8 |
| `status` | `'live' \| 'exhausted'` | default `live`, index `{status, createdAt}` |
| timestamps | Date | |

Virtual/derived in responses: `remaining = budget - spent`.

### 4.3 `Submission`
| Field | Type | Notes |
|---|---|---|
| `campaign` | ObjectId → Campaign | required, indexed |
| `creator` | ObjectId → User | required, indexed |
| `postUrl` | string | as submitted (trimmed) |
| `normalizedUrl` | string | **unique index** (see D11) |
| `views` | integer | default 0, ≥ 0 |
| `entitledAmount` | integer | default 0, high-water mark (D5) |
| `paidAmount` | integer | default 0, `paidAmount ≤ entitledAmount` |
| `lastViewsUpdatedAt` | Date | default = creation time |
| `flagged` | boolean | default false (bonus) |
| `flagReason` | string? | |
| `flaggedAt` | Date? | |
| timestamps | Date | |

### 4.4 Invariants (must always hold; tests assert them)
1. `0 ≤ campaign.spent ≤ campaign.budget`
2. `campaign.spent === Σ submission.paidAmount` for that campaign
3. `submission.paidAmount ≤ submission.entitledAmount`
4. `submission.paidAmount` and `submission.entitledAmount` never decrease
5. `campaign.status === 'exhausted'` iff `campaign.spent === campaign.budget`

---

## 5. API Contract

**Base path:** `/api`. JSON in/out. All authenticated routes use `Authorization: Bearer <jwt>`.

### 5.1 Error format (all errors)
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": [ { "path": "milestones.1.views", "message": "..." } ] } }
```
| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | zod failure, invalid ObjectId, bad JSON |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired token, bad login |
| 403 | `FORBIDDEN` | wrong role |
| 404 | `NOT_FOUND` | unknown resource, or resource not owned by caller (brand's campaign list) |
| 409 | `CONFLICT` | duplicate email, duplicate post URL, campaign not live |
| 429 | `RATE_LIMITED` | auth rate limit |
| 500 | `INTERNAL_ERROR` | anything else (never leak stack traces in production) |

### 5.2 Endpoints

| Method & Path | Auth | Description |
|---|---|---|
| `GET /health` | none | `{ status: "ok" }` (also checks DB connection state) |
| `POST /api/auth/signup` | none | Body `{ name, email, password, role }` → `201 { token, user }` |
| `POST /api/auth/login` | none | Body `{ email, password }` → `200 { token, user }` |
| `GET /api/auth/me` | any | → `{ user }` |
| `POST /api/campaigns` | brand | Create campaign → `201 { campaign }` |
| `GET /api/campaigns/mine` | brand | Brand's own campaigns with spent/remaining + submission counts |
| `GET /api/campaigns` | creator | **Live** campaigns (paginated: `?page=1&limit=20`, limit max 100) |
| `GET /api/campaigns/:id` | brand (owner) or creator | Single campaign (creators: only if `live`, else 404) |
| `GET /api/campaigns/:id/submissions` | brand (owner) | Submissions for the campaign (incl. `flagged`) |
| `POST /api/submissions` | creator | Body `{ campaignId, postUrl }` → `201 { submission }` |
| `GET /api/submissions/mine` | creator | Creator's submissions with campaign name/platform |
| `GET /api/creators/me/earnings` | creator | `{ totalEarnings, submissionCount, byCampaign: [...] }` |
| `PATCH /api/submissions/:id/views` | **none** | Body `{ views }` → payout result (see 5.4) |

### 5.3 Representative payloads

**Signup**
```json
{ "name": "Laugh Factory", "email": "a@b.com", "password": "min8chars", "role": "creator" }
```
Password: min 8 chars. Email: valid format. Response `user`: `{ id, name, email, role }`. Token: JWT payload `{ sub: userId, role }`, expiry from `JWT_EXPIRES_IN` (default `7d`).

**Create campaign**
```json
{
  "name": "Summer Drop",
  "platform": "instagram",
  "budget": 100000,
  "milestones": [
    { "views": 10000, "payout": 500 },
    { "views": 50000, "payout": 2000 },
    { "views": 100000, "payout": 5000 }
  ]
}
```
**Campaign response shape**
```json
{ "id": "...", "name": "...", "platform": "instagram", "budget": 100000, "spent": 0, "remaining": 100000,
  "status": "live", "milestones": [ { "views": 10000, "payout": 500 } ],
  "brand": { "id": "...", "name": "..." }, "submissionCount": 0, "createdAt": "..." }
```
(`brand` populated; `submissionCount` included on brand endpoints.)

**Submission response shape**
```json
{ "id": "...", "campaignId": "...", "campaign": { "id": "...", "name": "...", "platform": "instagram" },
  "postUrl": "...", "views": 0, "entitledAmount": 0, "paidAmount": 0, "capped": false,
  "flagged": false, "flagReason": null, "createdAt": "..." }
```
`capped = paidAmount < entitledAmount`.

### 5.4 `PATCH /api/submissions/:id/views`
Request: `{ "views": 60000 }` — `views` must be an integer, `0 ≤ views ≤ 2_000_000_000`. This is the **absolute** current view count (not an increment).

Response `200`:
```json
{
  "submission": { "...submission shape..." },
  "payout": {
    "previousPaid": 500,
    "delta": 1500,
    "paidAmount": 2000,
    "entitledAmount": 2000,
    "capped": false
  },
  "campaign": { "id": "...", "budget": 100000, "spent": 2000, "remaining": 98000, "status": "live" }
}
```
Errors: `400` invalid id/body, `404` submission not found.

---

## 6. Core Algorithm (authoritative)

### 6.1 Pure functions in `domain/payout.ts`
```ts
export interface Milestone { views: number; payout: number }

/** Payout of highest milestone with views >= threshold. 0 if none reached. Works with unsorted input. */
export function calculateEntitledPayout(views: number, milestones: readonly Milestone[]): number;

export interface DeltaInput {
  entitledAmount: number;   // high-water entitlement for the submission
  alreadyPaid: number;
  remainingBudget: number;  // budget - spent, >= 0
}
export interface DeltaResult { delta: number; capped: boolean }

/** delta = clamp(entitledAmount - alreadyPaid, 0, remainingBudget); capped = (alreadyPaid + delta) < entitledAmount */
export function calculatePayoutDelta(input: DeltaInput): DeltaResult;
```
Rules: inputs must be non-negative integers (throw `RangeError` otherwise). Functions never mutate inputs.

### 6.2 Transactional view update (`services/viewUpdateService.ts`)
```
updateViews(submissionId, views):
  session = mongoose.startSession()
  try:
    result = session.withTransaction(async () => {          // auto-retries TransientTransactionError
      sub      = Submission.findById(id).session(session)   -> 404 if null
      campaign = Campaign.findById(sub.campaign).session(session)
      now      = new Date()

      newEntitled = max(sub.entitledAmount, calculateEntitledPayout(views, campaign.milestones))
      remaining   = campaign.budget - campaign.spent
      { delta, capped } = calculatePayoutDelta({ entitledAmount: newEntitled, alreadyPaid: sub.paidAmount, remainingBudget: remaining })

      spike = detectSpike({ previousViews: sub.views, newViews: views, previousUpdatedAt: sub.lastViewsUpdatedAt, now })  // bonus

      // ALWAYS write the submission (this write serializes concurrent updates on the same submission)
      sub.views = views; sub.entitledAmount = newEntitled; sub.paidAmount += delta; sub.lastViewsUpdatedAt = now
      if spike.flagged && !sub.flagged: set flagged, flagReason, flaggedAt
      sub.save({ session })

      if delta > 0:
        newSpent = campaign.spent + delta
        res = Campaign.updateOne(
                { _id: campaign._id, spent: campaign.spent },           // compare-and-set guard
                { $set: { spent: newSpent, status: newSpent === campaign.budget ? 'exhausted' : 'live' } },
                { session })
        if res.matchedCount !== 1: throw new Error('Concurrent campaign update') // aborts txn; withTransaction retries
      return { sub, campaign state, payout details }
    })
    after commit: invalidate campaign cache (bonus)
    return result
  finally: session.endSession()
```
Notes for implementer:
- Compute everything **inside** the transaction callback from fresh reads (callback may re-run on retry; it must hold no outside mutable state other than the returned result).
- Domain errors (404) thrown inside the callback abort the transaction and propagate (not retried).
- Do **not** perform the campaign-wide budget check outside the transaction.
- Requires a replica set: Atlas M0 is one; the Docker compose Mongo and tests (`MongoMemoryReplSet`) must be configured as replica sets.

### 6.3 Worked examples (use as test fixtures; ladder = 10K→500, 50K→2,000, 100K→5,000)
| Scenario | views | alreadyPaid | remaining | entitled (after) | delta | capped |
|---|---|---|---|---|---|---|
| Below first milestone | 9,999 | 0 | 10,000 | 0 | 0 | false |
| Exactly on threshold | 10,000 | 0 | 10,000 | 500 | 500 | false |
| Climb to next | 50,000 | 500 | 10,000 | 2,000 | 1,500 | false |
| Skip two milestones | 60,000 | 0 | 10,000 | 2,000 | 2,000 | false |
| Top milestone, huge views | 10,000,000 | 2,000 | 10,000 | 5,000 | 3,000 | false |
| Budget short | 10,000 | 0 | 300 | 500 | 300 | **true** |
| Budget empty | 100,000 | 300 | 0 | 5,000 | 0 | true |
| Repeat same update | 50,000 | 2,000 | 10,000 | 2,000 | 0 | false |
| Views decrease | 20,000 | 2,000 | 10,000 | 2,000 (high-water) | 0 | false |

---

## 7. Phased Build Plan

Each phase lists **Tasks**, **Exit criteria**, and **Commit checkpoints**.

---

### Phase 0 — Repository & Tooling Setup

**Tasks**
1. `git init`; create `.gitignore` (node_modules, dist, .env*, .next, coverage; keep `.env.example`).
2. Create `backend/` and `frontend/` folders (do the frontend scaffold in Phase 9).
3. Backend: `npm init`, install deps:
   - runtime: `express cors helmet express-rate-limit mongoose zod jsonwebtoken bcryptjs ioredis dotenv`
   - dev: `typescript ts-node-dev @types/node @types/express @types/cors @types/jsonwebtoken @types/bcryptjs jest ts-jest @types/jest supertest @types/supertest mongodb-memory-server eslint` (+ `typescript-eslint`) and `prettier`
4. `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target ES2022`, `module commonjs`, `outDir dist`, `rootDir src`, `esModuleInterop: true`.
5. Scripts: `dev` (ts-node-dev), `build` (`tsc`), `start` (`node dist/server.js`), `test` (jest), `test:unit`, `test:integration`, `lint`.
6. `jest.config.ts`: `preset: 'ts-jest'`, `testEnvironment: 'node'`, `roots: ['<rootDir>/tests']`; integration tests get a longer timeout (30s).
7. `config/env.ts`: load and **validate with zod**; crash at boot on invalid config.
   - `NODE_ENV`, `PORT` (default 4000), `MONGODB_URI` (required), `JWT_SECRET` (required, ≥32 chars), `JWT_EXPIRES_IN` (default `7d`), `CORS_ORIGIN` (comma-separated list, required in production), `REDIS_URL` (optional), `SPIKE_MIN_DELTA` (default 10000), `SPIKE_RATE_PER_MIN` (default 1000), `CAMPAIGN_CACHE_TTL_SECONDS` (default 30).
8. Create `backend/.env.example` documenting every variable.

**Exit criteria:** `npm run build` and `npm test` (no tests yet → pass with `--passWithNoTests`) succeed.

**Commit checkpoints:** `chore: initialise repository and backend tooling`, `chore: add validated env configuration`.

---

### Phase 1 — Domain Core (Pure Logic) + Unit Tests *(do this before any DB code)*

**Tasks**
1. `domain/payout.ts` — implement `calculateEntitledPayout` and `calculatePayoutDelta` exactly per 6.1. Sort a **copy** of milestones internally; don't assume pre-sorted input. Validate integer/non-negative inputs.
2. `domain/milestones.ts` — `normalizeMilestones(input): Milestone[]` (sort ascending by `views`) and `validateMilestones(input, budget)` implementing D8 + D9. Return structured errors (path + message) usable by the zod layer.
3. `domain/postUrl.ts` — `validateAndNormalizePostUrl(url, platform): { ok: true, normalized } | { ok: false, reason }`:
   - Parse with `new URL`; protocol must be `http:` or `https:`.
   - **Instagram:** host `instagram.com` or `www.instagram.com`; path matches `/p/<id>`, `/reel/<id>`, `/reels/<id>`, or `/tv/<id>` (optionally preceded by `/<username>/`). Normalized form: `https://instagram.com/<type>/<id>` (lowercase host, drop query/hash/trailing slash; keep id case; the `/reels/` alias canonicalizes to `/reel/` so one reel has a single normalized URL — D11).
   - **YouTube:** hosts `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`. Accept `/watch?v=<id>`, `/shorts/<id>`, `youtu.be/<id>`. Normalized form: `https://youtube.com/watch?v=<id>` for all (shorts and youtu.be normalize to the same `watch?v=` form so one video can't be double-submitted). Video id = `[A-Za-z0-9_-]{6,20}`.
4. `domain/spike.ts` — stub now, implemented in Phase 10 (export the type + function signature so the service can call it).
5. **Unit tests (Jest)** — see Section 8 for the full required list.

**Exit criteria:** all unit tests green; 100% line/branch coverage on `payout.ts` and `milestones.ts`.

**Commit checkpoints:** `feat(domain): payout calculation and budget-capped delta`, `test(domain): payout and budget cap unit tests`, `feat(domain): milestone ladder validation`, `feat(domain): post URL validation and normalization`.

---

### Phase 2 — Database, Models, App Skeleton

**Tasks**
1. `config/db.ts`: `connectDb()` using Mongoose with `serverSelectionTimeoutMS`; log success/failure; `disconnectDb()`.
2. Models per Section 4 with TypeScript interfaces (`IUser`, `ICampaign`, `ISubmission`) and typed `Schema<…>`.
   - Add all indexes listed (`email` unique, `normalizedUrl` unique, `campaign`, `creator`, `{status, createdAt}`, `brand`).
   - `toJSON` transform: `id = _id.toString()`, remove `_id`, `__v`, `passwordHash`.
   - Mongoose-level validators: integer checks (`validate: Number.isInteger`), `min`, enums.
3. `errors/`: `AppError(statusCode, code, message, details?)` + `ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`.
4. Middleware: `asyncHandler`, `validate(schema, 'body'|'params'|'query')` (zod → `ValidationError`), `notFound`, `errorHandler` (maps `AppError`, `ZodError`, Mongoose `ValidationError`/`CastError`, Mongo duplicate key `11000` → 409, JWT errors → 401; everything else → 500 with no stack in production).
5. `app.ts`: `helmet`, `cors` (origins from env), `express.json({ limit: '100kb' })`, `app.set('trust proxy', 1)`, health route, route mounting under `/api`, `notFound`, `errorHandler`.
6. `server.ts`: connect DB → listen; handle `SIGTERM`/`SIGINT` with graceful shutdown; log `unhandledRejection`.

**Exit criteria:** server boots against a local/Atlas Mongo; `GET /health` returns 200; indexes are created.

**Commit checkpoints:** `feat(backend): mongoose models and indexes`, `feat(backend): express app, error handling, validation middleware`.

---

### Phase 3 — Authentication & Authorization

**Tasks**
1. Zod schemas: signup (`name` 1–80, `email` valid, `password` ≥ 8 and ≤ 72 chars (bcrypt limit), `role` enum), login.
2. `authService`: `signup` (lowercase email; hash with bcrypt cost 10; handle duplicate → `ConflictError`), `login` (generic `"Invalid email or password"` for both unknown email and wrong password; same status/message to avoid user enumeration), `signToken` (`{ sub, role }`).
3. Middleware `authenticate`: parse `Bearer` header, verify JWT, load user (to ensure still exists) and attach `req.user = { id, role }`. Augment Express `Request` type in `types/express.d.ts`.
4. Middleware `requireRole(...roles)` → 403 if mismatch.
5. Routes: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`. Apply `express-rate-limit` to signup/login (e.g. 20 requests / 15 min / IP; disabled when `NODE_ENV==='test'`).
6. Integration tests: signup success, duplicate email 409, weak password 400, login success/failure, `/me` with/without token, role guard.

**Exit criteria:** all auth tests pass; password hash never appears in any response.

**Commit checkpoints:** `feat(auth): signup, login and JWT middleware`, `test(auth): integration tests for auth flows`.

---

### Phase 4 — Brand: Campaigns

**Tasks**
1. Zod schema for `POST /api/campaigns`: `name`, `platform`, `budget` (positive int), `milestones` (array 1–20 of `{views, payout}` positive ints). Run `validateMilestones` (D8, D9); return per-field `details`.
2. `campaignService.create(brandId, input)`: normalize (sort) milestones, set `spent=0`, `status='live'`.
3. `GET /api/campaigns/mine` (brand): the brand's campaigns, newest first, each with `budget`, `spent`, `remaining`, `status`, `submissionCount` (use an aggregation or `countDocuments` grouped by campaign — avoid N+1 queries).
4. `GET /api/campaigns/:id` and `GET /api/campaigns/:id/submissions` with ownership checks (brand must own; otherwise 404). Validate ObjectId param.
5. A shared `toCampaignDTO()` that computes `remaining`.
6. Integration tests: create valid; invalid ladders (unsorted accepted & sorted; duplicate threshold rejected; non-increasing payout rejected; budget < smallest payout rejected); creator calling brand endpoint → 403; brand sees only their own campaigns; another brand's campaign → 404.

**Exit criteria:** brand can create and see budget spent vs. remaining via API.

**Commit checkpoints:** `feat(campaigns): create campaign with milestone validation`, `feat(campaigns): brand campaign listing with spent/remaining`, `test(campaigns): campaign integration tests`.

---

### Phase 5 — Creator: Browse Campaigns, Submit Posts, Earnings

**Tasks**
1. `GET /api/campaigns` (creator): `status: 'live'` only, sorted newest first, paginated (`page` default 1, `limit` default 20, max 100), response `{ items, page, limit, total }`. Populate brand `name`. Use `.lean()` and `select` only needed fields.
2. `POST /api/submissions` (creator): validate body `{ campaignId, postUrl }`.
   - Campaign must exist and be `live` (else 404 / 409 `CONFLICT` "Campaign is no longer live").
   - `validateAndNormalizePostUrl(postUrl, campaign.platform)` → 400 with reason on failure.
   - Create submission (`views: 0`, amounts 0, `lastViewsUpdatedAt: now`). Duplicate `normalizedUrl` → 409 (rely on the unique index + catch error 11000; don't rely on a pre-check alone).
3. `GET /api/submissions/mine` (creator): newest first, with campaign name/platform populated.
4. `GET /api/creators/me/earnings`: aggregation `$group` on `creator` → `totalEarnings = Σ paidAmount`, `submissionCount`, and `byCampaign` array `{ campaignId, campaignName, paidAmount, submissionCount }`. Return zeros when the creator has no submissions.
5. Integration tests: list shows only live campaigns; brand calling creator endpoint → 403; submit valid; submit URL for the wrong platform → 400; duplicate URL → 409; submit to exhausted campaign → 409; earnings with no submissions = 0.

**Exit criteria:** creator can browse, submit, and view earnings via API.

**Commit checkpoints:** `feat(creator): list live campaigns`, `feat(submissions): submit post with URL validation`, `feat(creator): earnings endpoint`, `test(submissions): integration tests`.

---

### Phase 6 — Views Update & Payout Engine

**Tasks**
1. Zod schema: params `{ id: ObjectId }`, body `{ views: int, 0..2_000_000_000 }`. Reject strings/floats/negatives (400).
2. Implement `services/viewUpdateService.ts` exactly as in **6.2** (transaction, CAS guard on `campaign.spent`, high-water entitlement, no clawback).
3. `PATCH /api/submissions/:id/views` — **no auth middleware** (D13). Controller returns the 5.4 response shape.
4. Make sure `Campaign.status` flips to `exhausted` in the same write that makes `spent === budget`.
5. Integration tests (using `MongoMemoryReplSet`):
   - Walk the ladder: 0 → 9,999 → 10,000 → 50,000 → 100,000; assert paid amounts 0, 0, 500, 2,000, 5,000 and campaign `spent`.
   - Skip two milestones in one update (60,000 from 0 → paid 2,000).
   - Repeating the same PATCH twice → second call `delta = 0`, `spent` unchanged.
   - Views decrease → views stored, paid unchanged.
   - Budget exhaustion mid-payout (partial pay, `capped: true`, status `exhausted`); further updates pay 0.
   - Multiple submissions drain one budget: Σ `paidAmount` === `campaign.spent` ≤ `budget`.
   - **Concurrency (stretch, required here):** fire `Promise.all` of ≥ 20 parallel PATCHes across several submissions on a tight budget → assert invariants 1–5 hold. Also fire 10 identical parallel PATCHes on one submission → paid exactly once.
   - Unknown submission id → 404; invalid id → 400; invalid body → 400.
6. After commit, call `invalidateCampaignCache()` (no-op until Phase 10).

**Exit criteria:** every worked example in 6.3 passes as an integration test; invariants hold under concurrency.

**Commit checkpoints:** `feat(payouts): transactional view update with budget cap`, `test(payouts): payout flow and budget exhaustion`, `test(payouts): concurrency and idempotency`.

---

### Phase 7 — Frontend (Next.js + TypeScript)

**Tasks**
1. Scaffold with `create-next-app` (TypeScript, App Router, ESLint, `src/` dir). `.env.example`: `NEXT_PUBLIC_API_URL=http://localhost:4000`.
2. `lib/api.ts`: typed `request<T>(path, options)` wrapper — attaches bearer token, parses JSON, throws a typed `ApiError { status, code, message, details }`; on `401` clears auth and redirects to `/login`.
3. `context/AuthContext.tsx`: `{ user, token, login, signup, logout, loading }`; persists token in `localStorage` (D16), loads `/api/auth/me` on mount; avoid SSR access to `localStorage` (guard with `typeof window`).
4. `ProtectedRoute` component: redirects unauthenticated users to `/login`; redirects wrong-role users to their own dashboard.
5. Pages:
   - `/` → redirect: not logged in → `/login`; brand → `/brand`; creator → `/creator`.
   - `/login`, `/signup` (signup includes a role selector: Brand / Creator). Show server validation errors inline.
   - `/brand`:
     - **Create campaign form:** name, platform select, budget, dynamic milestone rows (add/remove; `views` + `payout` inputs, min 1 row), client-side validation mirroring D8/D9, server errors displayed.
     - **Campaign list:** each campaign shows platform, status badge, **budget / spent / remaining** with a progress bar (`spent/budget`), milestone ladder, submission count. Expanding a campaign loads `/api/campaigns/:id/submissions` and shows post link, creator, views, paid, **flagged badge** (bonus).
   - `/creator`:
     - **Browse live campaigns** (cards: name, brand, platform, remaining budget, ladder). Pagination (Prev/Next).
     - **Submit post** form per campaign (post URL input, show server errors such as wrong platform / duplicate).
     - **My submissions** table: campaign, post link, views, entitled, paid, "capped" badge, flagged badge.
     - **Earnings summary** card at top: total earnings (₹, formatted `en-IN`).
     - **Demo-only "Simulate views" control** per submission (number input + button calling `PATCH /api/submissions/:id/views`, refreshes data). Label it clearly *"Demo: simulate platform data"*. This exists so the full flow can be demonstrated end-to-end in the deployed app.
6. Loading and error states on every data fetch; disable buttons while submitting; format money with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`.
7. Minimal styling only (single global CSS); must be usable on mobile width.

**Exit criteria:** with backend running locally, a full manual run works: brand signs up → creates campaign → creator signs up → submits post → simulates views → earnings and brand spent/remaining update.

**Commit checkpoints:** `feat(frontend): scaffold app and api client`, `feat(frontend): auth pages and context`, `feat(frontend): brand dashboard`, `feat(frontend): creator dashboard`.

---

### Phase 8 — Bonus: Redis Campaign-List Cache

**Tasks**
1. `config/redis.ts`: create an `ioredis` client **only if `REDIS_URL` is set**; on connection error log and continue (**app must work with no Redis**). Short `connectTimeout`; `maxRetriesPerRequest: 1`; `lazyConnect`.
2. Cache the **creator live-campaign list** (`GET /api/campaigns`). Key = `campaigns:live:v{version}:p{page}:l{limit}`; `version` read from key `campaigns:live:version` (default 0). TTL = `CAMPAIGN_CACHE_TTL_SECONDS` (30s).
3. **Invalidation = `INCR campaigns:live:version`** (cheap, avoids key scans). Trigger on: campaign created, and after every committed view update where `delta > 0` (spent/status changed).
4. All cache calls wrapped in try/catch: failures log a warning and fall through to Mongo. Add `X-Cache: HIT|MISS` response header.
5. Test: with a mocked cache layer, assert HIT/MISS and that invalidation happens on create and on payout.

**Exit criteria:** works with and without Redis; stale data is never served after a campaign creation or a payout.

**Commit checkpoints:** `feat(cache): optional redis cache for live campaign list`, `test(cache): cache hit/miss and invalidation`.

---

### Phase 9 — Bonus: Spike Detection

**Rule (D15, exact):** on each view update compute
- `increase = newViews - previousViews` (only when `> 0`)
- `elapsedMinutes = max((now - previousUpdatedAt) / 60000, 1)` (floor of 1 minute prevents divide-by-tiny)
- `ratePerMin = increase / elapsedMinutes`
- **Flag when** `increase >= SPIKE_MIN_DELTA` **AND** `ratePerMin >= SPIKE_RATE_PER_MIN`.

Defaults: `SPIKE_MIN_DELTA=10000`, `SPIKE_RATE_PER_MIN=1000`. For a new submission, `previousViews=0` and `previousUpdatedAt=createdAt`.

**Tasks**
1. Implement `domain/spike.ts`: `detectSpike({ previousViews, newViews, previousUpdatedAt, now }, thresholds): { flagged: boolean; reason?: string }`. Reason text e.g. `"+60000 views in 1.0 min (60000/min)"`.
2. Wire into `updateViews` (already stubbed in 6.2): set `flagged`, `flagReason`, `flaggedAt` once (don't overwrite an existing flag). **Do not block or reduce payouts.**
3. Expose `flagged`/`flagReason` in submission DTOs (already in the shape). Frontend shows badges (Phase 7).
4. Unit tests: below min delta, below rate, exactly at thresholds, slow growth over a long period, views decrease (no flag), first update.

**Commit checkpoints:** `feat(spike): flag unusually fast view growth`, `test(spike): detection unit tests`.

---

### Phase 10 — Dockerisation

**Tasks**
1. `backend/Dockerfile`: multi-stage (build with `npm ci && npm run build`; runtime stage `node:20-alpine`, `npm ci --omit=dev`, copy `dist`, run as non-root, `CMD ["node","dist/server.js"]`). Add `.dockerignore`.
2. `frontend/Dockerfile`: multi-stage Next.js build; use `output: 'standalone'` in `next.config.js`; `NEXT_PUBLIC_API_URL` is passed as a **build arg** (it is inlined at build time).
3. `docker-compose.yml` at repo root with services:
   - `mongo`: image `mongo:7`, command `["mongod","--replSet","rs0","--bind_ip_all"]`, healthcheck that initiates the replica set if needed, e.g. `mongosh --quiet --eval "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]}).ok }"`, with a volume.
   - `redis`: `redis:7-alpine`.
   - `backend`: depends_on healthy mongo; env `MONGODB_URI=mongodb://mongo:27017/memed?replicaSet=rs0`, `REDIS_URL=redis://redis:6379`, `JWT_SECRET`, `CORS_ORIGIN=http://localhost:3000`; port 4000.
   - `frontend`: build arg `NEXT_PUBLIC_API_URL=http://localhost:4000`; port 3000.
4. Verify: `docker compose up --build` → full flow works; PATCH-views transactions succeed (proves replica set config).

**Commit checkpoints:** `chore(docker): backend and frontend Dockerfiles`, `chore(docker): compose with mongo replica set and redis`.

---

### Phase 11 — Deployment (free tiers)

**Tasks**
1. **MongoDB Atlas (M0):** create cluster + DB user; Network Access allow `0.0.0.0/0` (Render free tier has no static IP; note this in README); copy the SRV connection string with database name `memed`.
2. **Render (Web Service, backend):** root dir `backend`; build `npm ci && npm run build`; start `npm start`; health check path `/health`. Env: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (long random), `CORS_ORIGIN=<vercel-url>`, optional thresholds. (Skip Redis in production unless a free Redis is available; the app must run without it.) Note in README: free tier sleeps → first request may take ~30–60 s.
3. **Vercel (frontend):** root dir `frontend`; env `NEXT_PUBLIC_API_URL=<render-url>`; deploy.
4. Update Render `CORS_ORIGIN` with the final Vercel URL (include preview domain if needed) and redeploy.
5. **Production smoke test** (record in README): signup both roles → create campaign → submit post → PATCH views → verify earnings and spent/remaining.
6. Put live URLs at the top of the README.

**Commit checkpoint:** `docs: add live URLs and deployment notes`.

---

### Phase 12 — Documentation & Final QA

**Tasks**
1. **README.md** must contain: project summary; live URLs; architecture overview (diagram optional); setup (local + Docker); env var table; API reference (table from 5.2 plus the PATCH example); how to run tests; **Assumptions (copy Decision Log D1–D18)**; known limitations (public PATCH endpoint, unverifiable post ownership, JWT in localStorage, free-tier cold starts); and the Scaling note.
2. **Scaling note — "How would this scale to 10,000 creators?"** (max half a page, ~250 words). Cover:
   - Stateless API behind a load balancer → horizontal scaling.
   - **Hot-document contention:** `campaign.spent` is a single hot document; at high write rates, split the budget into per-shard "allocation buckets" or reserve budget in chunks per worker; keep the transaction short.
   - Move view ingestion off the request path: platform webhooks/polling → queue (SQS/BullMQ) → workers with idempotency keys; batch updates.
   - Append-only **payout ledger** collection for audit/reconciliation, and a periodic job asserting invariants (`spent == Σ ledger`).
   - Indexes already in place; pagination everywhere; cache hot reads in Redis (already implemented for campaign list); read replicas for dashboards; pre-aggregated earnings counters.
   - Rate limiting per IP/user; observability (structured logs, metrics, alerts on flagged spikes); real platform APIs for view verification and authenticated PATCH (service-to-service auth).
3. **Final QA checklist** (all must be ticked):
   - [ ] `npm test` passes in `backend/`; coverage on `domain/payout.ts` and `domain/milestones.ts` = 100%
   - [ ] `npm run build` passes for backend and frontend with no TS errors
   - [ ] No `any` without justification; no `console.log` debugging left (use a tiny logger)
   - [ ] All Section 4.4 invariants verified by tests
   - [ ] No secrets committed; `.env.example` complete
   - [ ] `docker compose up` works from a clean clone
   - [ ] Deployed app passes the production smoke test
   - [ ] Git history: small, conventional commits following the checkpoints above
   - [ ] README contains assumptions and the scaling note

**Commit checkpoint:** `docs: readme with assumptions and scaling note`.

---

## 8. Required Test Matrix (Jest)

### 8.1 Unit — `calculateEntitledPayout`
- 0 views → 0; 9,999 → 0; 10,000 → 500 (inclusive boundary); 49,999 → 500; 50,000 → 2,000; 99,999 → 2,000; 100,000 → 5,000; 10,000,000 → 5,000
- Single-milestone ladder
- Unsorted ladder input yields the same results as sorted
- Input array is not mutated
- Negative or non-integer views → throws `RangeError`

### 8.2 Unit — `calculatePayoutDelta` (budget cap)
- Plenty of budget → `delta = entitled - paid`, `capped=false`
- Already fully paid → 0
- Remaining < needed → `delta = remaining`, `capped=true`
- Remaining = 0 → 0, `capped=true` (when entitled > paid)
- Remaining exactly equals needed → `delta = needed`, `capped=false`
- Entitled < paid (shouldn't happen, but guard) → delta 0, never negative
- **Property-style loop (seeded pseudo-random):** simulate many submissions/updates against a budget; assert `Σ delta ≤ budget` at all times, and every step's delta ≥ 0
- Invalid inputs (negative, float, NaN) → throws

### 8.3 Unit — milestones
- Valid ladder sorted ascending; duplicates in `views` rejected; payouts not strictly increasing rejected; zero/negative/float values rejected; >20 rows rejected; empty rejected; budget < smallest payout rejected

### 8.4 Unit — postUrl
- Valid Instagram `/p/`, `/reel/`, `/tv/` links (with query/trailing slash) normalize to the same string
- Valid YouTube `watch?v=`, `shorts/`, `youtu.be/` normalize to the same string for the same id
- Wrong platform host, non-http protocol, malformed URL, missing id → rejected

### 8.5 Unit — spike (Phase 9) — see Phase 9

### 8.6 Integration — see Phases 3–6, 8 (in-memory Mongo **replica set**)
Setup: a shared helper that starts `MongoMemoryReplSet` once per test file, clears collections between tests, calls `Model.init()` so unique indexes exist, and tears down afterwards.

---

## 9. Coding Standards

- **TypeScript:** `strict`; explicit return types on exported functions; shared DTO types; no implicit `any`; `unknown` + narrowing in catch blocks.
- **Layering:** routes → controllers (parse/validate/respond) → services (business logic, DB) → domain (pure). Controllers contain no business logic; domain contains no I/O.
- **Async:** every handler wrapped by `asyncHandler`; no floating promises; no `.then` chains where `await` is clearer.
- **Errors:** only throw `AppError` subclasses from services; one `errorHandler` formats all responses; log unexpected errors server-side only.
- **Validation:** all external input (body, params, query, env) validated with zod before use.
- **Security:** `helmet`, strict CORS allowlist, JSON body limit, bcrypt, generic login errors, auth rate limiting, no secrets in the repo.
- **Naming/style:** `camelCase` for variables/functions, `PascalCase` for types/models, files by feature; Prettier + ESLint clean.
- **Logging:** a minimal logger wrapper (no stray `console.log`).

---

## 10. Environment Variables (reference)

**Backend**
| Var | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | |
| `PORT` | no | `4000` | |
| `MONGODB_URI` | yes | — | Must point to a replica set (Atlas/compose) |
| `JWT_SECRET` | yes | — | ≥ 32 chars |
| `JWT_EXPIRES_IN` | no | `7d` | |
| `CORS_ORIGIN` | prod: yes | `http://localhost:3000` | Comma-separated allowlist |
| `REDIS_URL` | no | — | Enables cache if set |
| `CAMPAIGN_CACHE_TTL_SECONDS` | no | `30` | |
| `SPIKE_MIN_DELTA` | no | `10000` | |
| `SPIKE_RATE_PER_MIN` | no | `1000` | |

**Frontend**
| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL (no trailing slash) |

---

## 11. Out of Scope (do not build)
Password reset, email verification, refresh tokens, campaign editing/deletion/pausing, real Instagram/YouTube API integration, real payment processing, file uploads, admin role, i18n, comprehensive frontend automated tests (manual verification is sufficient for the frontend).

---

## 12. Clarifying Questions & Assumed Defaults

The spec above already assumes the defaults below so work is never blocked. **If any default is wrong, change the matching Decision Log row before building.**

| # | Question | Assumed default (already in spec) |
|---|---|---|
| Q1 | Money as integer rupees (no paise)? | Yes (D1) |
| Q2 | When budget runs out mid-payout, pay the remainder (partial) or skip the payout entirely? | Pay the remainder (D4) |
| Q3 | If reported views decrease, keep payouts (no clawback)? | Yes, keep (D5) |
| Q4 | Is `PATCH .../views` body the absolute view count (not an increment)? | Absolute (5.4) |
| Q5 | Must a higher milestone always pay more than a lower one (strictly increasing ladder)? | Yes (D8) |
| Q6 | Is one post URL allowed in only one campaign globally? | Yes (D11) |
| Q7 | Spike thresholds OK (≥10,000 views gained and ≥1,000 views/min), flag-only, no payout hold? | Yes (Phase 9) |
| Q8 | Is a clearly-labelled demo "Simulate views" control on the creator page acceptable? | Yes (Phase 7) |
| Q9 | Is requiring a MongoDB replica set (for transactions) acceptable? (Atlas M0 qualifies.) | Yes (D7) |
| Q10 | Leave `PATCH .../views` fully public (per brief) vs. an optional shared-secret header? | Fully public (D13) |
| Q11 | Next.js App Router with plain CSS, JWT in localStorage? | Yes (D16) |

# Meme'd

Meme'd is a creator marketplace where **brands** run campaigns and **creators** (meme pages, clip
accounts, hype pages) post content for those campaigns on Instagram or YouTube. Creators are paid
through a **view-milestone payout ladder**: a post earns the payout of the highest milestone its
views have reached (not the sum of milestones), and total payouts for a campaign can never exceed
the campaign's budget. Brands create campaigns with a budget and a milestone ladder; creators
submit posts, track views, and watch their earnings update as a post climbs the ladder.

## Contents

- [Project status](#project-status)
- [Live demo](#live-demo)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Architecture overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Local setup — backend](#local-setup--backend)
- [Local setup — frontend](#local-setup--frontend)
- [Running the tests](#running-the-tests)
- [What the tests cover](#what-the-tests-cover)
- [Production smoke test](#production-smoke-test)
- [API reference](#api-reference)
- [Assumptions and design decisions](#assumptions-and-design-decisions)
- [Known limitations](#known-limitations)
- [How would this scale to 10,000 creators?](#how-would-this-scale-to-10000-creators)

---

## Project status

**Complete:** the backend API (auth, campaigns, submissions, the transactional view-update and
payout engine, and creator earnings), the Next.js frontend, and the free-tier deployment. All 299
tests pass, and the pure domain modules are at 100% coverage.

**Bonus items done:** spike detection (Phase 9) — unusually fast view growth is flagged for review,
and flagging never affects a payout.

**Deliberately out of scope** (spec §11): password reset, email verification, refresh tokens,
campaign editing/deletion/pausing, real Instagram/YouTube API integration, real payment processing,
file uploads, an admin role, i18n, and comprehensive frontend automated tests (the frontend is
verified manually).

**Not built:** the Redis campaign-list cache (Phase 8, a bonus) and Dockerisation (Phase 10). The
live demo URLs are still placeholders — see [Live demo](#live-demo).

---

## Live demo

| Service | URL |
|---|---|
| Frontend | https://memed-liart.vercel.app |
| Backend | https://memed-api-nch1.onrender.com |
| Health endpoint | https://memed-api-nch1.onrender.com/health |

> The backend is hosted on a free tier, so the first request after a period of idle can take
> roughly **30–60 seconds** while it wakes up. Subsequent requests are fast.

**Try it:** sign up as a **brand** and as a **creator** in two browsers (or one normal window and
one incognito window). As the brand, create a campaign with a milestone ladder. As the creator,
submit a post to that campaign, then use the demo **Simulate** control on the creator's submissions
table to move the post up the ladder and watch the creator's earnings and the brand's spent/remaining
budget update.

---

## Features

**Brand**

- Sign up / log in (JWT-based auth; role chosen at signup).
- Create a campaign with a platform, a budget, and a validated milestone ladder.
- See your own campaigns with budget, spent, remaining, status, and submission counts.
- Open a campaign to see its submissions, including any flagged as a spike.

**Creator**

- Browse live campaigns (paginated), with brand, platform, remaining budget, and ladder.
- Submit a post URL; it is validated against the campaign platform and normalized.
- See your own submissions with views, entitled amount, paid amount, and status badges.
- See an earnings summary: total earnings and a per-campaign breakdown.
- Use the clearly-labelled demo **Simulate** control to feed platform-style view data.

**Payout engine**

- **Highest-milestone payout** — a post is paid the amount of the highest milestone it has reached,
  never the sum of milestones.
- **Partial payout when the budget runs short** — the payout is capped at the campaign's remaining
  budget; the submission is marked `capped` and the campaign becomes `exhausted` at zero remaining.
- **No double-pay on repeated updates** — repeating the same view update pays nothing extra
  (idempotent); money moves only when entitlement rises above what was already paid.
- **Transactional concurrency safety** — each view update runs in a MongoDB transaction with a
  compare-and-set guard, so concurrent updates can never overspend the budget or double-pay.
- **Spike flagging** — unusually fast view growth is flagged for review; flagging never blocks,
  reduces, or delays a payout.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 20+ (`engines: >=20`; developed on v24.16.0), TypeScript 5.9.3 (strict), Express 4.22.3 |
| Database | MongoDB + Mongoose 8.24.5 (a replica set is required for transactions) |
| Validation | zod 4.6.7 |
| Auth | jsonwebtoken 9.0.3, bcryptjs 3.0.3 |
| Security | helmet 8.3.0, cors 2.8.6, express-rate-limit 8.7.1 |
| Frontend | Next.js 16.4.0 (App Router), React 19.3.0, TypeScript 5.9.3, plain CSS |
| Tests | Jest 29.7.0 + ts-jest 29.4.14, supertest 7.3.1, mongodb-memory-server 11.3.0 (replica set) |
| Package manager | npm (lockfiles committed) |

---

## Repository layout

```text
memed/
├── README.md
├── docs/
│   ├── MEMED_BUILD_SPEC.md      # authoritative build spec
│   ├── PHASE_NOTES.md           # phase-by-phase working notes
│   └── phase0_doc.md … phase6_doc.md   # per-phase code walkthroughs
├── backend/
│   ├── package.json  tsconfig.json  jest.config.ts  .env.example  .dockerignore
│   ├── src/
│   │   ├── app.ts               # builds the Express app (no listen) — used by tests
│   │   ├── server.ts            # connects DB, starts server, graceful shutdown
│   │   ├── config/              # env.ts (zod-validated), db.ts, logger.ts
│   │   ├── domain/              # PURE logic: payout.ts, milestones.ts, postUrl.ts, spike.ts
│   │   ├── models/              # User.ts, Campaign.ts, Submission.ts, toJSON.ts
│   │   ├── services/            # auth, campaign, submission, viewUpdate, earnings, DTOs
│   │   ├── controllers/         # thin HTTP handlers
│   │   ├── routes/              # auth, campaigns, submissions, creators, health
│   │   ├── middleware/          # authenticate, requireRole, validate, errorHandler, …
│   │   ├── errors/              # AppError + subclasses
│   │   ├── validators/          # zod schemas for bodies, params, query
│   │   ├── schemas/             # auth input schemas
│   │   └── types/               # shared TS types, express.d.ts augmentation
│   └── tests/
│       ├── unit/                # payout, milestones, postUrl, spike, env, pagination, schemas, DTOs
│       └── integration/         # auth, campaigns, submissions, views, earnings, spike (replica set)
└── frontend/
    ├── package.json  tsconfig.json  next.config.ts  .env.example
    └── src/
        ├── app/                 # layout, page, login/, signup/, brand/, creator/
        ├── components/          # forms, tables, ProgressBar, ProtectedRoute, badges, …
        ├── context/AuthContext.tsx
        ├── lib/                 # api.ts (typed fetch client), authStorage, format, validation
        └── types/               # mirrors the API types
```

---

## Architecture overview

The backend is layered **routes → controllers → services → domain**. Routes declare paths,
auth, and validation; controllers parse the request and shape the response; services hold the
business logic and talk to MongoDB; and the **domain** layer is pure, I/O-free logic. All payout
arithmetic lives in exactly one pure module, `backend/src/domain/payout.ts`
(`calculateEntitledPayout`, `calculatePayoutDelta`), so the money rules are deterministic, easy to
test, and impossible to duplicate elsewhere. The transactional view update sits in
`backend/src/services/viewUpdateService.ts`: it reads the submission and campaign, computes the new
entitlement and delta via the domain module, writes the submission, and updates the campaign's
`spent` with a compare-and-set guard — all inside a single MongoDB transaction.

```text
Browser
   │  HTTPS
   ▼
Next.js (App Router)  ──  frontend/
   │  fetch + Authorization: Bearer <JWT>
   ▼
Express API  ──  backend/src/
   │  Mongoose
   ▼
MongoDB (replica set — required for transactions)
```

---

## Prerequisites

- **Node.js 20 or newer** — the backend declares `engines: { node: ">=20" }` and was developed on
  Node v24.16.0.
- **npm** — lockfiles are committed, so `npm ci` or `npm install` both work.
- **MongoDB running as a replica set.** The view-update path uses a MongoDB transaction, and
  transactions require a replica set, so a standalone `mongod` will not work. MongoDB Atlas free
  (M0) clusters are replica sets by default, so an Atlas connection string works as-is.

---

## Local setup — backend

```bash
cd backend
npm install
cp .env.example .env      # then edit the values below
```

Every variable the backend reads (validated by `backend/src/config/env.ts`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | HTTP port the API listens on |
| `MONGODB_URI` | **yes** | — | MongoDB connection string; must point at a replica set |
| `JWT_SECRET` | **yes** | — | Secret used to sign JWTs; at least 32 characters |
| `JWT_EXPIRES_IN` | no | `7d` | JWT lifetime (e.g. `7d`, `12h`, `60m`) |
| `CORS_ORIGIN` | prod: **yes** | `http://localhost:3000` | Comma-separated list of allowed browser origins |
| `REDIS_URL` | no | — | Read but currently unused (the Redis cache is not implemented) |
| `CAMPAIGN_CACHE_TTL_SECONDS` | no | `30` | Read but currently unused (the Redis cache is not implemented) |
| `SPIKE_MIN_DELTA` | no | `10000` | Minimum absolute view gain to be eligible for spike flagging |
| `SPIKE_RATE_PER_MIN` | no | `1000` | Minimum views-per-minute growth rate to be flagged |

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Commands:

```bash
npm run dev     # start the API with ts-node-dev (http://localhost:4000)
npm run build   # compile TypeScript to dist/
npm start       # run the compiled server (node dist/server.js)
```

---

## Local setup — frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

The frontend reads one variable:

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | Backend base URL, no trailing slash (e.g. `http://localhost:4000`) |

Commands:

```bash
npm run dev     # start the Next.js dev server (http://localhost:3000)
npm run build   # production build
```

The backend's `CORS_ORIGIN` must include the frontend origin (for local development,
`http://localhost:3000`), or the browser will block API requests.

---

## Running the tests

From `backend/`:

```bash
npm test                 # all unit + integration tests
npm run test:unit        # unit tests only
npm run test:integration # integration tests only
npm run test:coverage    # tests + coverage (fails unless the domain files are 100%)
```

The integration tests boot an **in-memory MongoDB replica set** (`mongodb-memory-server`), so they
need no external database. The first run downloads a `mongod` binary; later runs are fast.

**Test results** (run on 2026-10-14):

| Metric | Result |
|---|---|
| Test suites | 22 passed / 22 |
| Tests | 299 passed / 299 |
| Coverage — `src/domain/payout.ts` | 100% statements, 100% branches, 100% functions, 100% lines |
| Coverage — `src/domain/milestones.ts` | 100% statements, 100% branches, 100% functions, 100% lines |
| Coverage — `src/domain/spike.ts` | 100% statements, 100% branches, 100% functions, 100% lines |

---

## What the tests cover

- **Payout calculation and boundaries** — every milestone boundary (exactly on a threshold, just
  below, skipping rungs, huge view counts), unsorted ladders, and input validation.
- **The budget cap** — partial payouts when the budget runs short, an empty budget, and a seeded
  simulation proving total payouts never exceed the budget.
- **Milestone validation** — ladder size, strictly increasing views and payouts, duplicate
  thresholds, and the minimum-budget rule.
- **URL normalization** — Instagram and YouTube links collapse to one canonical form; wrong-platform
  and malformed links are rejected.
- **Spike detection** — the flagging rule at and around its thresholds, slow growth, decreases, and
  reason formatting.
- **Auth** — signup, login, duplicate email, weak passwords, token handling, and the role guard.
- **Campaign rules** — creation, validation, ownership scoping, and role restrictions.
- **Concurrency and idempotency** — parallel view updates never overspend the budget or double-pay,
  and repeating an update pays nothing extra.

---

## Production smoke test

`scripts/smoke-test.mjs` is a dependency-free end-to-end check that exercises a **running** backend
over HTTP. It uses only the Node 20+ built-in `fetch`, so it needs no packages and no database of its
own — point it at any environment (local or deployed) and it walks the full brand + creator flow:

1. `GET /health` returns 200 (retried a few times so a cold free-tier instance can wake up).
2. Sign up a brand and a creator.
3. The brand creates an Instagram campaign (budget 10000, ladder 1000→100 and 5000→400).
4. The creator lists live campaigns and finds it.
5. The creator submits a post (201, zero amounts); the same URL again returns 409.
6. `PATCH` views: 1000 pays 100, repeating pays 0, 5000 pays 300 more, then a decrease pays 0.
7. Creator earnings show `totalEarnings` 400.
8. The brand's campaign list shows `spent` 400 and `remaining` 9600.
9. A creator token calling `POST /api/campaigns` returns 403.

It prints one `PASS`/`FAIL` line per step and exits `0` when every step passes, or `1` on the first
failure. Tokens are never printed.

```bash
# Against a local backend (default base URL is http://localhost:4000):
node scripts/smoke-test.mjs

# Against a deployed backend:
BASE_URL=https://your-backend.example node scripts/smoke-test.mjs
```

Each request has a 90-second timeout, and the health check is retried up to 3 times (20 seconds
apart), so a sleeping free-tier instance has time to wake up before the run fails.

---

## API reference

All endpoints are JSON over HTTP. Everything except `GET /health` lives under `/api`.

### Conventions

- **Auth** — send `Authorization: Bearer <JWT>` on authenticated endpoints. The token comes from
  signup or login.
- **Errors** — every error uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "A valid email is required" }]
  }
}
```

`details` is present on validation errors (an array of `{ path, message }`).

| HTTP status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body, params, or query failed validation |
| 401 | `UNAUTHENTICATED` | Missing, malformed, or expired token |
| 403 | `FORBIDDEN` | Authenticated but wrong role, or not the campaign owner |
| 404 | `NOT_FOUND` | Resource does not exist or is not visible to you |
| 409 | `CONFLICT` | Duplicate (e.g. email already registered) |
| 429 | `RATE_LIMITED` | Too many requests (signup/login: 20 per 15 min per IP) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | Liveness + DB state |
| POST | `/api/auth/signup` | none | Register; `role` is `brand` or `creator` |
| POST | `/api/auth/login` | none | Log in |
| GET | `/api/auth/me` | any | Current user |
| POST | `/api/campaigns` | brand | Create a campaign |
| GET | `/api/campaigns/mine` | brand | Your campaigns, with submission counts |
| GET | `/api/campaigns` | creator | Live campaigns, paginated |
| GET | `/api/campaigns/:id` | brand (owner) or creator | One campaign |
| GET | `/api/campaigns/:id/submissions` | brand (owner) | Submissions for a campaign |
| POST | `/api/submissions` | creator | Submit a post |
| GET | `/api/submissions/mine` | creator | Your submissions |
| GET | `/api/creators/me/earnings` | creator | Earnings summary |
| PATCH | `/api/submissions/:id/views` | **none** | Update views and run the payout (D13) |

> **`PATCH /api/submissions/:id/views` is intentionally public** (decision D13). It stands in for a
> platform view-count webhook, so it takes no token. It is the only write endpoint without auth.

### Request and response shapes

The examples below are real responses captured from the running app.

**Sign up** — `POST /api/auth/signup` → `201`

```bash
curl -s -X POST "$API/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"name":"Laugh Factory","email":"brand@example.com","password":"min8chars","role":"brand"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "6acf7524f753cd539d91e6b7",
    "name": "Laugh Factory",
    "email": "brand@example.com",
    "role": "brand"
  }
}
```

**Log in** — `POST /api/auth/login` → `200` returns the same `{ token, user }` shape.

**Create a campaign** — `POST /api/campaigns` (brand) → `201`

The ladder may be sent in any order; the service sorts it before storing (D8). This request sends
the rungs out of order:

```bash
curl -s -X POST "$API/api/campaigns" -H "Authorization: Bearer $BRAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Summer Drop","platform":"instagram","budget":100000,
       "milestones":[{"views":50000,"payout":2000},{"views":10000,"payout":500},{"views":100000,"payout":5000}]}'
```

```json
{
  "campaign": {
    "id": "6acf7524f753cd539d91e6bd",
    "name": "Summer Drop",
    "platform": "instagram",
    "budget": 100000,
    "spent": 0,
    "remaining": 100000,
    "status": "live",
    "milestones": [
      { "views": 10000, "payout": 500 },
      { "views": 50000, "payout": 2000 },
      { "views": 100000, "payout": 5000 }
    ],
    "createdAt": "2026-10-14T12:27:16.839Z",
    "brand": { "id": "6acf7524f753cd539d91e6b7", "name": "Laugh Factory" }
  }
}
```

**List live campaigns** — `GET /api/campaigns?page=1&limit=20` (creator) → `200`

`page` defaults to `1`, `limit` to `20` (maximum `100`).

```json
{
  "items": [
    {
      "id": "6acf7524f753cd539d91e6bd",
      "name": "Summer Drop",
      "platform": "instagram",
      "budget": 100000,
      "spent": 0,
      "remaining": 100000,
      "status": "live",
      "milestones": [
        { "views": 10000, "payout": 500 },
        { "views": 50000, "payout": 2000 },
        { "views": 100000, "payout": 5000 }
      ],
      "createdAt": "2026-10-14T12:27:16.839Z",
      "brand": { "id": "6acf7524f753cd539d91e6b7", "name": "Laugh Factory" }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

**Submit a post** — `POST /api/submissions` (creator) → `201`

```bash
curl -s -X POST "$API/api/submissions" -H "Authorization: Bearer $CREATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"campaignId":"6acf7524f753cd539d91e6bd","postUrl":"https://www.instagram.com/p/ABC123/?igsh=xyz"}'
```

```json
{
  "submission": {
    "id": "6acf7524f753cd539d91e6c6",
    "campaignId": "6acf7524f753cd539d91e6bd",
    "postUrl": "https://www.instagram.com/p/ABC123/?igsh=xyz",
    "views": 0,
    "entitledAmount": 0,
    "paidAmount": 0,
    "capped": false,
    "flagged": false,
    "flagReason": null,
    "createdAt": "2026-10-14T12:27:16.903Z",
    "campaign": { "id": "6acf7524f753cd539d91e6bd", "name": "Summer Drop", "platform": "instagram" }
  }
}
```

**Update views** — `PATCH /api/submissions/:id/views` (public, D13) → `200`

`views` is the **absolute** current count (integer `0`–`2,000,000,000`). The response carries three
blocks: the updated `submission`, the `payout` this call produced, and the campaign's new budget
state. This example first sets `10000` (pays 500), then `60000` (pays the 1500 difference):

```bash
curl -s -X PATCH "$API/api/submissions/6acf7524f753cd539d91e6c6/views" \
  -H 'Content-Type: application/json' -d '{"views":60000}'
```

```json
{
  "submission": {
    "id": "6acf7524f753cd539d91e6c6",
    "campaignId": "6acf7524f753cd539d91e6bd",
    "postUrl": "https://www.instagram.com/p/ABC123/?igsh=xyz",
    "views": 60000,
    "entitledAmount": 2000,
    "paidAmount": 2000,
    "capped": false,
    "flagged": true,
    "flagReason": "+10000 views in 1.0 min (10000/min)",
    "createdAt": "2026-10-14T12:27:16.903Z",
    "campaign": { "id": "6acf7524f753cd539d91e6bd", "name": "Summer Drop", "platform": "instagram" }
  },
  "payout": {
    "previousPaid": 500,
    "delta": 1500,
    "paidAmount": 2000,
    "entitledAmount": 2000,
    "capped": false
  },
  "campaign": {
    "id": "6acf7524f753cd539d91e6bd",
    "budget": 100000,
    "spent": 2000,
    "remaining": 98000,
    "status": "live"
  }
}
```

> The `flagged`/`flagReason` fields appear here only because the two updates were sent seconds
> apart, which trips the spike rule (a large, fast jump). Flagging is informational — it never
> changes the payout. In normal use the updates arrive minutes apart and are not flagged.

**Earnings** — `GET /api/creators/me/earnings` (creator) → `200`

```json
{
  "earnings": {
    "totalEarnings": 2000,
    "submissionCount": 1,
    "byCampaign": [
      {
        "campaignId": "6acf7524f753cd539d91e6bd",
        "campaignName": "Summer Drop",
        "paidAmount": 2000,
        "submissionCount": 1
      }
    ]
  }
}
```

**Health** — `GET /health` → `200`

```json
{ "status": "ok", "db": "connected" }
```

### End-to-end walkthrough

A copy-paste sequence that exercises the whole flow (requires the API running and `jq`):

```bash
API=http://localhost:4000

# 1. Register a brand and a creator
BRAND_TOKEN=$(curl -s -X POST "$API/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"name":"Laugh Factory","email":"brand@example.com","password":"min8chars","role":"brand"}' | jq -r .token)
CREATOR_TOKEN=$(curl -s -X POST "$API/api/auth/signup" -H 'Content-Type: application/json' \
  -d '{"name":"Meme Lord","email":"creator@example.com","password":"min8chars","role":"creator"}' | jq -r .token)

# 2. Brand creates a campaign
CAMPAIGN_ID=$(curl -s -X POST "$API/api/campaigns" -H "Authorization: Bearer $BRAND_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Summer Drop","platform":"instagram","budget":100000,"milestones":[{"views":10000,"payout":500},{"views":50000,"payout":2000},{"views":100000,"payout":5000}]}' \
  | jq -r .campaign.id)

# 3. Creator browses live campaigns and submits a post
curl -s "$API/api/campaigns?page=1&limit=20" -H "Authorization: Bearer $CREATOR_TOKEN" | jq '.items[].name'
SUBMISSION_ID=$(curl -s -X POST "$API/api/submissions" -H "Authorization: Bearer $CREATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"campaignId\":\"$CAMPAIGN_ID\",\"postUrl\":\"https://www.instagram.com/p/ABC123/\"}" | jq -r .submission.id)

# 4. Views arrive (public endpoint) — the payout runs
curl -s -X PATCH "$API/api/submissions/$SUBMISSION_ID/views" \
  -H 'Content-Type: application/json' -d '{"views":60000}' | jq .payout

# 5. Creator checks earnings
curl -s "$API/api/creators/me/earnings" -H "Authorization: Bearer $CREATOR_TOKEN" | jq .earnings.totalEarnings
```

### Differences from the spec

The routes match spec §5.2 exactly (same methods, paths, auth, and roles). Three response shapes
differ slightly from the spec's wording:

- `GET /api/creators/me/earnings` wraps the payload in an `earnings` object
  (`{ "earnings": { "totalEarnings", "submissionCount", "byCampaign" } }`); §5.2 shows the fields at
  the top level.
- `GET /health` returns an extra `db` field (`{ "status": "ok", "db": "connected" }`); §5.2 shows
  only `{ "status": "ok" }`.
- `GET /api/campaigns/:id` for a brand does **not** include `submissionCount` (only
  `GET /api/campaigns/mine` does); §5.3 says submission counts appear on brand endpoints.

---

## Assumptions and design decisions

These are the decisions the build follows — the spec's Decision Log, copied verbatim (D1–D18). Every
one is implemented as written; the two spec cross-reference slips are noted after the table.

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

> **Two spec cross-reference slips (not behaviour differences).** D15 points at "Phase 10" for the
> spike rule, but the rule is in **Phase 9** (Phase 10 is Dockerisation); the code implements the
> Phase 9 rule. D7's parenthetical mentions a Docker replica set, but Docker is not implemented in
> this repo (see Known limitations). Every decision above is otherwise implemented exactly as
> written.

### How payouts work

A post is paid the amount of the **highest milestone it has reached**, not the sum of the milestones
below it. As views grow, the creator is paid the **difference** between the new entitlement and what
they have already been paid, so the total for a post never exceeds its highest reached milestone.

Worked example with the ladder **10K → ₹500, 50K → ₹2,000, 100K → ₹5,000**:

| Scenario | Views | Entitled | Paid this update | Total paid | Notes |
|---|---|---|---|---|---|
| Below the first rung | 9,999 | ₹0 | ₹0 | ₹0 | No milestone reached |
| First rung reached | 10,000 | ₹500 | ₹500 | ₹500 | Threshold is inclusive |
| Second rung reached | 50,000 | ₹2,000 | ₹1,500 | ₹2,000 | Pays the difference from ₹500 |
| Two rungs skipped in one update | 60,000 (straight from 0) | ₹2,000 | ₹2,000 | ₹2,000 | Highest rung only — ₹2,000, not ₹2,500 |
| Views fall after a payout | 20,000 (after reaching 50,000) | ₹2,000 | ₹0 | ₹2,000 | High-water mark — no clawback |
| Budget runs short | — | ₹500 | ₹300 | ₹300 | Only ₹300 remains; submission marked `capped` |
| Same update repeated | unchanged | unchanged | ₹0 | unchanged | Idempotent — no double-pay |

### Concurrency and idempotency

Each view update runs inside a single **MongoDB transaction**. The campaign write uses a
**compare-and-set guard** on the exact `spent` value that was read, so if another transaction moved
it first the update aborts and retries. The submission is **always written** on every update, so
concurrent updates on the same submission conflict and the loser retries. Entitlement is a
**high-water mark** (`entitledAmount = max(previousEntitled, payoutFor(views))`), so it never
decreases and a repeated update pays nothing extra.

The spec's §4.4 invariants, and the tests that assert them:

1. `0 ≤ campaign.spent ≤ campaign.budget`
2. `campaign.spent === Σ submission.paidAmount` for that campaign
3. `submission.paidAmount ≤ submission.entitledAmount`
4. `submission.paidAmount` and `submission.entitledAmount` never decrease
5. `campaign.status === 'exhausted'` iff `campaign.spent === campaign.budget`

- Invariants **1, 2, 3 and 5** are asserted by the `assertInvariants` helper in
  `backend/tests/integration/viewUpdate.test.ts`, which runs after every update in all four groups
  (including the 20-way overspend race and the 10-way double-pay race), and by the same helper in
  `backend/tests/integration/spike.test.ts`.
- Invariant **4** is checked by the "stores a decreased view count but never claws money back (D5)"
  and "mixed race on one submission settles on the highest entitlement" tests in
  `viewUpdate.test.ts`, and by spike tests 6 and 8.
- The budget bound is also checked at the pure-function level by the seeded property test "never
  lets total payouts exceed the budget across many simulated updates" in
  `backend/tests/unit/payout.test.ts`.

### Spike flagging

A spike is **only ever flagged** — it never blocks, reduces, or delays a payout. The rule (in
`backend/src/domain/spike.ts`):

```text
increase       = newViews - previousViews            (only when > 0)
elapsedMinutes = max((now - previousUpdatedAt) / 60000, 1)
ratePerMin     = increase / elapsedMinutes
flagged        = increase >= minDelta AND ratePerMin >= ratePerMinThreshold
```

- **Default thresholds:** `minDelta` = **10,000** views, `ratePerMin` = **1,000** views/min.
- **Environment variables:** `SPIKE_MIN_DELTA` and `SPIKE_RATE_PER_MIN` (both optional; the defaults
  above apply when unset).
- **Never affects money:** a flagged and an unflagged submission with the same views pay exactly the
  same (spike test 2).
- **Set once and sticky:** the flag is written only when it is not already set
  (`if (spike.flagged && !submission.flagged)`), and it is **never cleared** — a later small increase
  or a decrease leaves `flagged`, `flagReason`, and `flaggedAt` unchanged (spike tests 6, 7 and 8).
- **Why the 1-minute floor:** `elapsedMinutes` is floored at 1 so that a zero or negative elapsed
  time (two updates in the same instant, or a clock that moved backwards) cannot divide by zero or
  produce an infinite rate.

### Validation rules

- **Milestone ladder:** 1–20 milestones; `views` and `payout` are positive integers; after sorting
  ascending by `views`, **both** `views` and `payout` must be **strictly increasing** (no duplicate
  thresholds; a higher threshold must pay more).
- **Budget:** a positive integer, and **≥ the smallest milestone payout**.
- **Post URL:** must be valid `http`/`https` and match the campaign platform. Instagram accepts
  `/p/`, `/reel/`, `/reels/` and `/tv/` links (with an optional username prefix); YouTube accepts
  `watch?v=`, `shorts/` and `youtu.be/` links. The URL is normalized to a canonical form.
- **One post, once, globally:** `normalizedUrl` is **globally unique**, so the same post cannot be
  submitted twice in any campaign.

---

## Known limitations

- **The view-update endpoint is public by design (D13).** `PATCH /api/submissions/:id/views` takes no
  token, so anyone who knows a submission id can set its view count. It stands in for simulated
  platform data; in production it must be replaced with authenticated, service-to-service ingestion
  plus real platform view verification.
- **Post ownership cannot be verified (D11).** The app checks that a URL is well-formed and matches
  the campaign platform, but it cannot confirm that the submitting creator actually owns the
  account, so a creator could submit someone else's link.
- **The JWT is stored in `localStorage` (D16).** This is simple and works across tabs, but any script
  on the page can read it, so a cross-site scripting (XSS) bug could steal the token. An httpOnly
  cookie would remove that exposure at the cost of CSRF handling.
- **Free-tier hosting cold starts.** The deployed backend runs on a free tier that sleeps when idle,
  so the first request after a pause can take roughly 30–60 seconds. The MongoDB Atlas cluster allows
  network access from `0.0.0.0/0` because Render's free tier has no static IP.
- **No password reset, refresh tokens, campaign editing, or real payments** (out of scope). Tokens
  simply expire after `JWT_EXPIRES_IN` (default `7d`).
- **Spike flags cannot be reviewed or dismissed.** A flag is set once and is sticky; there is no
  endpoint or UI to inspect, confirm, or clear it.
- **Open build TODO items.** The Redis campaign-list cache (Phase 8) and the Docker setup (Phase 10)
  are not implemented, and the live demo URLs are still placeholders in this README.

---

## How would this scale to 10,000 creators?

The API is stateless — all state lives in MongoDB and the JWT — so it scales horizontally behind a
load balancer with no sticky sessions; adding instances is the first lever.

The first bottleneck is **hot-document contention**: every view update writes the same
`campaign.spent` field inside a transaction, so one viral campaign serialises writes. At high write
rates, split a campaign's budget into allocation buckets, or reserve budget in chunks per worker, so
workers contend on different documents and the transaction stays short.

Second, move view ingestion **off the request path**: platform webhooks or polling feed a queue
(SQS or BullMQ), and workers apply updates in batches with idempotency keys, absorbing bursts and
retrying safely.

Third, add an append-only **payout ledger** for audit and reconciliation, plus a periodic job that
asserts the invariants — `campaign.spent` equals the sum of ledger entries — so drift is caught
early.

For reads, the existing indexes and pagination already help; add a Redis cache for the hot campaign
list, read replicas for dashboards, and pre-aggregated earnings counters so dashboards never scan
submissions.

Finally, add per-user and per-IP rate limiting, structured logs and metrics with alerts on flagged
spikes, and replace the public views endpoint with real platform APIs for view verification behind
service-to-service auth.

# Meme'd

A creator marketplace. **Brands** run campaigns; **creators** (meme pages, clip accounts, hype
pages) post content for those campaigns on Instagram or YouTube. Creators are paid through a
**milestone ladder** based on the views a post reaches.

| Views threshold | Payout |
|---|---|
| 10,000 | ₹500 |
| 50,000 | ₹2,000 |
| 100,000 | ₹5,000 |

**Core rules**

- A post's payout = the payout amount of the **highest milestone its views have reached** (not the
  sum of milestones).
- Total payouts for a campaign must **never exceed** the campaign's budget.

> `MEMED_BUILD_SPEC.md` (repo root) is the single source of truth for this project. If anything in
> this README conflicts with it, the spec wins.

---

## Live URLs

> _Filled in at Phase 11 (deployment)._

| Service | URL |
|---|---|
| Frontend (Vercel) | _TBD_ |
| Backend (Render) | _TBD_ |
| Database | MongoDB Atlas M0 |

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 20 LTS, TypeScript (strict), Express 4, MongoDB + Mongoose 8 |
| Validation | `zod` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Security | `helmet`, `cors`, `express-rate-limit` |
| Frontend | Next.js (App Router) + TypeScript, plain CSS |
| Tests | Jest + `ts-jest`, `supertest`, `mongodb-memory-server` (replica set) |
| Bonus | Redis via `ioredis` (optional at runtime) |
| Package manager | `npm` (lockfile committed) |
| Deploy | MongoDB Atlas (M0), Render (backend), Vercel (frontend) |

---

## Repository layout

```
memed/
├── README.md
├── MEMED_BUILD_SPEC.md
├── docker-compose.yml          (Phase 10)
├── .gitignore
├── backend/
│   ├── package.json  tsconfig.json  tsconfig.test.json  jest.config.ts  .env.example
│   └── src/
│       ├── config/             # env.ts (zod-validated) + db.ts, redis.ts (later phases)
│       ├── domain/             # PURE logic: payout, milestones, postUrl, spike
│       ├── models/ services/ controllers/ routes/ middleware/ errors/ validators/ types/
│   └── tests/
│       ├── unit/
│       └── integration/        # MongoMemoryReplSet
└── frontend/                   # Next.js app (scaffolded in Phase 7)
```

---

## Getting started (local)

### Prerequisites

- Node.js 20+ (developed against Node 24 locally)
- A MongoDB **replica set** (required for transactions). Either:
  - MongoDB Atlas M0 (free), or
  - the Docker compose Mongo service (`--replSet rs0`), or
  - a local `mongod --replSet rs0` you have initiated.
- Optional: Redis (the app runs fine without it).

### Backend

```bash
cd backend
cp .env.example .env        # then edit values (JWT_SECRET >= 32 chars, MONGODB_URI)
npm install
npm run dev                 # starts on http://localhost:4000
```

Health check: `GET http://localhost:4000/health` → `{ "status": "ok" }`.

```bash
npm run build               # tsc -> dist/
npm start                   # node dist/server.js
npm test                    # all Jest tests
npm run test:unit           # tests/unit
npm run test:integration    # tests/integration
npm run lint                # ESLint
```

### Frontend

> _Scaffolded in Phase 7._

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:3000
```

### Docker (Phase 10)

```bash
docker compose up --build
```

---

## Environment variables

### Backend

| Var | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | HTTP port |
| `MONGODB_URI` | **yes** | — | Must point to a replica set (Atlas/compose) |
| `JWT_SECRET` | **yes** | — | ≥ 32 chars |
| `JWT_EXPIRES_IN` | no | `7d` | JWT lifetime |
| `CORS_ORIGIN` | prod: **yes** | `http://localhost:3000` | Comma-separated allowlist |
| `REDIS_URL` | no | — | Enables cache if set |
| `CAMPAIGN_CACHE_TTL_SECONDS` | no | `30` | Live-campaign cache TTL |
| `SPIKE_MIN_DELTA` | no | `10000` | Spike flag threshold (views gained) |
| `SPIKE_RATE_PER_MIN` | no | `1000` | Spike flag threshold (views/minute) |

### Frontend

| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **yes** | Backend base URL (no trailing slash) |

---

## API reference

> _Full table and payloads land with Phases 3–6. Base path `/api`; errors use a single shape
> `{ "error": { "code", "message", "details" } }`._

| Method & Path | Auth | Description |
|---|---|---|
| `GET /health` | none | `{ status: "ok" }` (checks DB too) |
| `POST /api/auth/signup` | none | `201 { token, user }` |
| `POST /api/auth/login` | none | `200 { token, user }` |
| `GET /api/auth/me` | any | `{ user }` |
| `POST /api/campaigns` | brand | Create campaign |
| `GET /api/campaigns/mine` | brand | Own campaigns + spent/remaining + submission counts |
| `GET /api/campaigns` | creator | Live campaigns (paginated) |
| `GET /api/campaigns/:id` | brand owner / creator | Single campaign |
| `GET /api/campaigns/:id/submissions` | brand owner | Campaign submissions |
| `POST /api/submissions` | creator | Submit a post |
| `GET /api/submissions/mine` | creator | Own submissions |
| `GET /api/creators/me/earnings` | creator | `{ totalEarnings, submissionCount, byCampaign }` |
| `PATCH /api/submissions/:id/views` | **none** | Simulated platform view update → payout result |

---

## Assumptions (Decision Log)

These decisions resolve every open point in the brief. They are final and implemented as written.

| # | Topic | Decision |
|---|---|---|
| D1 | Currency / number type | All money is stored and computed as **integer rupees** (₹). No floats, no paise. Non-integer money input is rejected. |
| D2 | Milestone semantics | Payout is the amount of the highest milestone with `threshold <= views` (inclusive). Milestones are **not** cumulative; crossing two milestones in one update pays the highest only. |
| D3 | Paying in increments | On each update the creator receives the **difference** between current entitlement and what has already been paid. Total paid never exceeds the highest reached milestone. |
| D4 | Budget runs out mid-payout | **Partial payout:** delta capped at remaining budget; submission recorded as `capped`; campaign marked `exhausted` at zero remaining. Shortfall is never made up. |
| D5 | Views decreasing | Views are stored as given, but payouts are **monotonic** (`entitledAmount` is a high-water mark). No clawback; a decrease never produces a negative delta. |
| D6 | Idempotency | Repeating the same PATCH yields delta = 0. Money moves only when entitlement rises above paid. |
| D7 | Concurrency | Each view update runs in a **MongoDB transaction** with retry on transient errors; concurrent updates can never overspend or double-pay. |
| D8 | Milestone ladder validation | 1–20 milestones, positive integers, strictly increasing in both `views` and `payout` after ascending sort. Server sorts before storing. |
| D9 | Budget validation | `budget` is a positive integer and ≥ the smallest milestone payout. |
| D10 | Campaign lifecycle | `live` on creation → `exhausted` when `spent === budget`. Only `live` campaigns are listed/accept submissions. No edit/delete/pause. |
| D11 | Post URL rules | Valid `http(s)` URL matching the campaign platform, normalized; `normalizedUrl` is **globally unique**. Post ownership cannot be verified (documented limitation). |
| D12 | Who can submit | Only `creator` role. A creator may submit multiple different posts to one campaign. |
| D13 | PATCH views endpoint is public | No auth on the PATCH endpoint (simulates platform data). Security implication documented below. |
| D14 | Earnings | A creator's total earnings = sum of `paidAmount` across their submissions. |
| D15 | Spike flag (bonus) | Flag only; **payouts are not blocked**. |
| D16 | Auth storage (frontend) | JWT in `localStorage`, sent as `Authorization: Bearer <token>`. |
| D17 | Roles chosen at signup | `role` is `brand` or `creator`; cannot be changed afterwards. |
| D18 | IDs in API | API returns `id` (string), not `_id`/`__v`. |

---

## Known limitations

- **Public `PATCH /api/submissions/:id/views`** (D13): anyone who knows a submission id can set its
  view count and therefore trigger payouts. This simulates platform data per the brief; in
  production this endpoint would be service-to-service authenticated (shared secret / mTLS).
- **Post ownership cannot be verified** (D11): the platform APIs are not integrated, so the app
  cannot confirm the submitting creator actually owns the post.
- **JWT in `localStorage`** (D16): simpler than httpOnly cookies but exposed to XSS. Mitigated by
  React's default escaping and no `dangerouslySetInnerHTML`; documented trade-off.
- **Requires a MongoDB replica set** for transactions (D7). Atlas M0 qualifies.
- **Free-tier cold starts**: the Render backend sleeps, so the first request after idle may take
  ~30–60 s.

---

## Scaling note — how this would scale to 10,000 creators

> _Completed in Phase 12._

---

## Build status

| Phase | Description | Status |
|---|---|---|
| 0 | Repository & tooling setup | ✅ Done |
| 1 | Domain core (pure logic) + unit tests | ⏳ Pending |
| 2 | Database, models, app skeleton | ⏳ Pending |
| 3 | Auth & authorization | ⏳ Pending |
| 4 | Brand: campaigns | ⏳ Pending |
| 5 | Creator: browse, submit, earnings | ⏳ Pending |
| 6 | Views update & payout engine | ⏳ Pending |
| 7 | Frontend (Next.js) | ⏳ Pending |
| 8 | Bonus: Redis campaign-list cache | ⏳ Pending |
| 9 | Bonus: spike detection | ⏳ Pending |
| 10 | Dockerisation | ⏳ Pending |
| 11 | Deployment (free tiers) | ⏳ Pending |
| 12 | Documentation & final QA | ⏳ Pending |

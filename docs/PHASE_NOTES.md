# Meme'd — Phase Notes

> Plain-language working notes describing what has been built so far, phase by phase, and where
> to change things. Useful for quickly getting up to speed before making changes.
>
> **Source of truth:** `docs/MEMED_BUILD_SPEC.md` (the only copy). If anything here conflicts with
> the spec, the spec wins.

---

## Build status

| Phase | Description | Status |
|---|---|---|
| 0 | Repository & tooling setup | ✅ Done |
| 1 | Domain core (pure logic) + unit tests | ✅ Done |
| 2 | Database, models, app skeleton | ✅ Done |
| 3 | Authentication & authorization | ✅ Done |
| 4 | Brand: campaigns | ✅ Done |
| 5 | Creator: browse, submit, earnings | ✅ Done |
| 6 | Views update & payout engine | ✅ Done |
| 7 | Frontend (Next.js) | ✅ Done |
| 8 | Bonus: Redis campaign-list cache | ❌ Not implemented |
| 9 | Bonus: spike detection | ✅ Done |
| 10 | Dockerisation | ❌ Not implemented |
| 11 | Deployment (free tiers) | ✅ Done |
| 12 | Documentation & final QA | ✅ Done (only the Docker QA item is blocked, pending Phase 10) |

> **Phase 11 (deployment) is complete.** The live URLs recorded in the README under "Live demo" are
> real and stable — they are **not** placeholders (frontend on Vercel, backend on Render). The backend
> runs on a free tier, so the first request after a period of idle can take roughly 30–60 seconds.
>
> **Not implemented:** Phase 8 (Redis campaign-list cache) and Phase 10 (Dockerisation) were not
> built. `backend/src/services/cacheService.ts` is a deliberate no-op stub, and there are no
> Dockerfiles or `docker-compose.yml` in the repository. The frontend is complete and working end to
> end (Phase 7); it is deployed as a normal Next.js app on Vercel, which is why no container is
> needed for the live demo.

---

## 1. What the product is

**Meme'd** is a creator marketplace:

- A **brand** creates a **campaign** with a budget and a **milestone ladder**, e.g.
  10K views → ₹500, 50K views → ₹2,000, 100K views → ₹5,000.
- A **creator** submits a post (Instagram or YouTube link) to a campaign.
- As the post's views climb, the creator earns money — capped by the campaign's budget.

The deliverable is a deployed web app where brands create campaigns and creators submit posts and
track earnings.

---

## 2. The money rules (the part that matters most)

Every part of the system exists to enforce these rules. They come from the Decision Log (D1–D18)
in the build spec.

1. **Not cumulative.** 60,000 views on the example ladder pays **₹2,000** (the highest rung
   reached), *not* ₹2,500 (the sum of rungs). (D2)
2. **Never over budget.** Total paid on a campaign can never exceed its budget. (D4)
3. **Pay in increments.** Each view update pays only the *difference* between what the creator is
   now owed and what has already been paid. (D3)
4. **Partial payout when the budget runs out.** Pay whatever is left and mark the submission
   "capped". The shortfall is never made up later. (D4)
5. **No clawback.** If views go down, payouts never shrink. Entitlement is a "high-water mark". (D5)
6. **Idempotent.** Sending the same view count again pays ₹0 the second time. (D6)

---

## 3. How the code is organised

The backend follows a strict layering; each layer only talks to the ones below it:

```
routes → controllers → services → domain
```

| Layer | Job | Contains I/O? | Built yet? |
|---|---|---|---|
| `routes/` | Map URLs to handlers | no | ✅ (Phase 2) |
| `controllers/` | Thin HTTP handlers (auth handlers still live inline in `routes/`) | HTTP only | ✅ (Phase 4) |
| `services/` | Business logic, database access | DB | ✅ (Phase 3) |
| `domain/` | **Pure logic** — the "brain" | **no** | ✅ (Phase 1) |

**"Pure logic"** means: no database, no network, no HTTP. Just functions in, values out — like a
calculator or a rulebook. This is deliberate: pure code is the easiest to test and the hardest to
get wrong. Later layers *call* this brain; they never re-implement the math anywhere else
(spec rule: *"All money logic lives in one pure module."*).

---

## 4. Repository map

```
Memed/
├── README.md                ← human-facing docs; includes the planned API table
├── .gitignore
├── docs/                    ← project documentation
│   ├── MEMED_BUILD_SPEC.md  ← the rules (authoritative, single source of truth)
│   ├── PHASE_NOTES.md       ← this file
│   ├── phase0_doc.md        ← Phase 0 code explained (tooling & env config)
│   ├── phase1_doc.md        ← Phase 1 code explained (domain core)
│   ├── phase2_doc.md        ← Phase 2 code explained (db, models, app skeleton)
│   ├── phase3_doc.md        ← Phase 3 code explained (auth)
│   ├── phase4_doc.md        ← Phase 4 code explained (brand campaigns)
│   ├── phase5_doc.md        ← Phase 5 code explained (creator browse / submit / earnings)
│   ├── phase6_doc.md        ← Phase 6 code explained (transactional view update & payouts)
│   └── phase7_doc.md        ← Phase 7 code explained (frontend)
├── scripts/
│   └── smoke-test.mjs       ← dependency-free production smoke test (Phase 11)
├── backend/
│   ├── src/
│   │   ├── app.ts           ← builds the Express app (no listen) (Phase 2)
│   │   ├── server.ts        ← connects DB, listens, graceful shutdown (Phase 2)
│   │   ├── config/          ← env.ts (Phase 0), db.ts + logger.ts (Phase 2)
│   │   ├── domain/          ← THE BRAIN: pure logic (Phase 1)
│   │   │   ├── payout.ts
│   │   │   ├── milestones.ts
│   │   │   ├── postUrl.ts
│   │   │   └── spike.ts     ← stub in Phase 1, real rule from Phase 9
│   │   ├── errors/          ← AppError + subclasses (Phase 2)
│   │   ├── middleware/      ← asyncHandler, validate, notFound, errorHandler (Phase 2); authenticate, requireRole (Phase 3)
│   │   ├── models/          ← User, Campaign, Submission + toJSON transform (Phase 2)
│   │   ├── routes/          ← health + /api aggregator (Phase 2); auth (Phase 3); campaigns (Phase 4); submissions, creators (Phase 5); views (Phase 6)
│   │   ├── controllers/     ← thin HTTP handlers (Phase 4+)
│   │   ├── schemas/         ← zod request schemas (Phase 3)
│   │   ├── validators/      ← zod request schemas (Phase 4–6)
│   │   ├── services/        ← authService (Phase 3); campaignService, campaignDto, submissionDto (Phase 4);
│   │   │                      submissionService, earningsService (Phase 5); viewUpdateService (Phase 6);
│   │   │                      cacheService no-op stub (Phase 8 hook)
│   │   └── types/           ← Express Request augmentation (Phase 3)
│   ├── tests/
│   │   ├── unit/            ← Phase 1 tests (+ env, schemas, DTOs, spike from later phases)
│   │   ├── integration/     ← health, models, errorHandling (Phase 2); auth (Phase 3); campaigns (Phase 4);
│   │   │                      submissions, earnings (Phase 5); viewUpdate (Phase 6); spike (Phase 9)
│   │   ├── helpers/mongo.ts ← in-memory replica set helper (Phase 2)
│   │   └── setup.ts
│   ├── package.json  tsconfig.json  tsconfig.test.json  jest.config.ts
│   ├── eslint.config.mjs  .prettierrc  .dockerignore  .env.example
└── frontend/                ← complete Next.js app (Phase 7), deployed on Vercel
    ├── src/app/             ← layout, page, login/, signup/, brand/, brand/campaigns/new/, creator/
    ├── src/components/      ← AppShell, ProtectedRoute, forms, tables, badges, skeletons, Tabs, …
    ├── src/context/         ← AuthContext (JWT in localStorage, D16)
    ├── src/lib/             ← api.ts (typed fetch client), authStorage, campaignValidation, format
    └── src/types/           ← mirrors the API types
```

---

## 5. Git branches

| Branch | Contains | Status |
|---|---|---|
| `main` | Everything through Phase 11 + the README/deployment docs | Merge target; up to date as of 2026-10-14 |
| `backend-dev` | Backend phases 0–6 + docs | Merged into `main` (PRs #1, #3, #5, #6) |
| `frontend-dev` | Frontend phases 7 + UI redesign | Merged into `main` (PRs #2, #4) |
| `spike-detection` | Phase 9 spike detection | Merged into `main` (via the backend PRs) |
| `feature/create-campaign-page` | Extra frontend polish (own create-campaign page, tabs) | Not merged — same tip as `feat/dockerise` |
| `feat/dockerise` | **Currently checked out** — 4 frontend commits ahead of `main` | Despite the name it contains **no Docker files**; Phase 10 was never started |

All phase work is merged; the only commits not yet on `main` are the four recent frontend UI
improvements on `feat/dockerise`.

---

## 6. Phase 0 — Setup & tooling

This phase created the skeleton so code can be written and checked automatically. Nothing runs a
server yet.

| File | What it is, simply |
|---|---|
| `.gitignore` | Tells git to ignore junk: `node_modules`, build output, `.env` secrets, logs. Keeps `.env.example`. |
| `backend/package.json` | Lists the libraries used and the **commands** you run (see §11). |
| `backend/tsconfig.json` | TypeScript rules. `strict: true` makes TS catch many bugs before runtime. `noUncheckedIndexedAccess` makes array access safer. |
| `backend/tsconfig.test.json` | A TS config used only for tests (includes the `tests/` folder). |
| `backend/jest.config.ts` | Test-runner config (Jest). Coverage rules were added here in Phase 1. |
| `backend/eslint.config.mjs` | Style/lint rules (flags unused code, discourages `any`). |
| `backend/.prettierrc` | Auto-formatting rules (single quotes, semicolons, 100-char lines). |
| `backend/.env.example` | Template listing every setting the server needs; copy to `.env` locally. |
| `backend/.dockerignore` | Prepared for Phase 10 (Docker) so containers wouldn't copy junk; **unused today**, since Docker was never built. |
| `backend/tests/setup.ts` | Injects fake settings before tests run, so importing config doesn't crash. |

**The one piece of real code in Phase 0:** `backend/src/config/env.ts`.

It reads environment variables and **validates them with `zod`**. If something critical is missing
or wrong (e.g. `JWT_SECRET` shorter than 32 characters), the server **refuses to start** with a
clear error instead of misbehaving later. It also requires `CORS_ORIGIN` in production and treats
empty strings as "not set". `backend/tests/unit/env.test.ts` proves this with 7 tests.

Settings it reads: `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`,
`REDIS_URL`, `CAMPAIGN_CACHE_TTL_SECONDS`, `SPIKE_MIN_DELTA`, `SPIKE_RATE_PER_MIN`.

---

## 7. Phase 1 — Domain core (the brain)

Four files in `backend/src/domain/`, each with one clear job.

### 7.1 `payout.ts` — the money calculator

The single source of all payout maths.

- **`calculateEntitledPayout(views, milestones)`** → "given these views and this ladder, how much is
  the creator *owed*?"
  - Example: 60,000 views → **2,000**.
  - Works even if the ladder is passed unsorted (it sorts a copy internally; the input is never
    mutated).
  - Throws `RangeError` if views is negative or not a whole number.
- **`calculatePayoutDelta({ entitledAmount, alreadyPaid, remainingBudget })`** → "given what's owed,
  what's been paid, and what budget is left, how much do we pay *now*?"
  - `delta = clamp(owed − alreadyPaid, 0, remainingBudget)`
  - Returns `capped: true` when the campaign cannot cover the full amount.
  - This is what makes money rules #3, #4 and #6 work.

This file also defines the **`Milestone`** type (`{ views, payout }`) used everywhere.

### 7.2 `milestones.ts` — the ladder rule-checker

Validates the ladder a brand enters (D8 + D9).

- **`normalizeMilestones(input)`** → returns a copy sorted ascending by views.
- **`validateMilestones(input, budget)`** → checks:
  - 1–20 rungs
  - every `views` and `payout` is a positive whole number
  - after sorting, **views strictly increase** (no duplicate thresholds)
  - **payouts strictly increase** (a higher rung must pay more)
  - budget ≥ the smallest payout (otherwise the campaign could never pay anyone)
  - On success, returns the sorted ladder. On failure, returns a list of `{ path, message }` errors
    (e.g. `milestones.1.views`) that the API can hand straight to the frontend.

### 7.3 `postUrl.ts` — the link cleaner

Ensures one post cannot be submitted twice under different link spellings (D11: `normalizedUrl` is
globally unique).

- **`validateAndNormalizePostUrl(url, platform)`** → `{ ok: true, normalized }` or
  `{ ok: false, reason }`.
- **Instagram:** accepts `/p/<id>`, `/reel/<id>`, `/reels/<id>`, `/tv/<id>` (optionally with a
  username prefix). Drops query strings / hashtags / trailing slashes; lowercases the host.
  - `https://www.instagram.com/p/ABC123/?igsh=xyz` → `https://instagram.com/p/ABC123`
  - The `/reels/<id>` alias **canonicalizes to `/reel/<id>`**, so the same reel always yields one
    normalized URL (keeps D11's "one post can't be submitted twice" honest).
- **YouTube:** accepts `watch?v=<id>`, `/shorts/<id>`, `youtu.be/<id>` — and all of them normalize
  to the *same* form `https://youtube.com/watch?v=<id>` (so one video can't be double-submitted).
- Rejects wrong-platform links, non-http(s) URLs, malformed URLs and missing ids.

### 7.4 `spike.ts` — spike detection (bonus, Phase 9)

Detects suspiciously fast view growth. It was a stub through Phases 1–8; **Phase 9 implemented the
real rule**: flag when the view gain is `>= SPIKE_MIN_DELTA` (default 10,000) **and** the rate is
`>= SPIKE_RATE_PER_MIN` (default 1,000 views/min), with the elapsed time floored at one minute. A
spike is only ever *flagged* — it never blocks or reduces a payout, and the flag is set once and
never cleared. Covered by unit tests plus 10 integration tests in
`tests/integration/spike.test.ts`.

### 7.5 Tests & coverage (`backend/tests/unit/`)

- `payout.test.ts` — every boundary (exactly 10K, just under, skipping rungs, budget shortfall,
  empty budget, views decrease), plus a **seeded random simulation** proving payouts never exceed
  the budget.
- `milestones.test.ts` — valid / unsorted / duplicate / non-increasing / too many / too few /
  budget-too-small.
- `postUrl.test.ts` — Instagram and YouTube normalization plus all rejection cases, including the
  `/reels/` → `/reel/` canonicalization.

Result: **102 tests passing**, and **100% line/branch coverage** enforced on `payout.ts` and
`milestones.ts` (the Phase 1 exit criteria). The coverage gate genuinely fails the build when
coverage drops.

---

## 8. Phase 2 — Database, models, app skeleton

The app now has a real (if small) HTTP surface. Everything follows the spec's layering
(routes → middleware → models), with the pure domain untouched.

| Piece | What it is |
|---|---|
| `config/db.ts` | `connectDb()` / `disconnectDb()` with `serverSelectionTimeoutMS` — fails fast, never hangs. |
| `models/User.ts` | name, email (unique, lowercased), `passwordHash` (`select: false`), role enum. |
| `models/Campaign.ts` | brand ref, platform, budget/spent (integer-validated), milestones subdocs, status, `{status, createdAt}` index, `remaining` virtual. |
| `models/Submission.ts` | campaign/creator refs, `normalizedUrl` **globally unique** (D11), views/entitled/paid (integer, ≥ 0), `capped` virtual. |
| `models/toJSON.ts` | shared transform: API returns `id`, never `_id`/`__v`/`passwordHash` (D18). |
| `errors/` | `AppError` + `ValidationError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitedError`. |
| `middleware/` | `asyncHandler` (no floating promises), `validate` (zod → 400 with per-field details), `notFound`, `errorHandler` (maps AppError/zod/Mongoose/duplicate-key/JWT to the §5.1 envelope; 500s never leak). |
| `app.ts` | helmet, CORS allowlist from env, JSON body limit 100kb, `trust proxy`, `/health`, `/api` mount, notFound + errorHandler. |
| `server.ts` | connect DB → listen; SIGTERM/SIGINT graceful shutdown; `unhandledRejection` logged. |
| `routes/health.ts` | `GET /health` → `{ status: "ok", db: <state> }`. |

**Tests (integration, in-memory Mongo replica set):** `health.test.ts` (200 + error envelope),
`models.test.ts` (unique indexes, validators, D18 serialization, compound index),
`errorHandling.test.ts` (every error mapping + the validation middleware).

Result: **122 tests passing** (102 unit + 20 integration), coverage gate still 100% on
`payout.ts`/`milestones.ts`, build + lint + prettier clean.

---

## 9. Phase 3 — Authentication & authorization

Users can now sign up, log in, and identify themselves with a JWT. The role guard is in
place for the brand/creator split that Phases 4–5 build on.

| Piece | What it is |
|---|---|
| `schemas/auth.ts` | zod schemas: signup (name 1–80, email, password 8–72, role enum) and login. Email is trimmed + lowercased **before** the format check. |
| `services/authService.ts` | `signup` (bcrypt cost 10; duplicate email → 409 via the unique index), `login` (identical "Invalid email or password" for unknown email and wrong password — no user enumeration), `signToken` (`{ sub, role }`, expiry from `JWT_EXPIRES_IN`). |
| `middleware/authenticate.ts` | Parses `Bearer` token, verifies JWT, loads the user from the DB (deleted users lose access), attaches `req.user = { id, role }`. |
| `middleware/requireRole.ts` | `requireRole('brand', ...)` → 403 on mismatch. |
| `types/express.d.ts` | Augments Express `Request` with `user`. |
| `routes/auth.ts` | `POST /api/auth/signup` (201), `POST /api/auth/login` (200), `GET /api/auth/me` (200). Signup/login rate-limited 20 req / 15 min / IP, disabled in tests. |

**Tests (`tests/integration/auth.test.ts`, 18 cases):** signup success + hash never in any
response, duplicate email 409, weak / 72+-char passwords, invalid email/role/name, login
success/failure (identical 401 for unknown email), `/me` with/without/forged token, and the
role guard (brand 200 / creator 403 / anonymous 401).

Result: **140 tests passing** (102 unit + 38 integration), coverage gate still 100%,
build + lint + prettier clean.

---

## 10. Phase 4 — Brand: Campaigns

A brand can now create campaigns and read them back with live budget figures. This is the first
phase with a separate `controllers/` layer (thin handlers) and a `validators/` folder.

| Piece | What it is |
|---|---|
| `validators/campaign.ts` | zod body schema for `POST /api/campaigns`: name, platform, budget (positive int), milestones (1–20 of `{views, payout}` positive ints). Cross-field ladder rules (D8/D9) run through `validateMilestones` and come back as per-field `details`. |
| `validators/common.ts` | `objectIdParamSchema` — a malformed `:id` is a 400 before any DB call. |
| `services/campaignDto.ts` | `toCampaignDTO()` — the shared campaign shape; derives `remaining = budget − spent`; never leaks `_id`/`__v`. |
| `services/submissionDto.ts` | `toSubmissionDTO()` — the shared submission shape (spec §5.3) plus `creator { id, name }`; derives `capped = paidAmount < entitledAmount`. |
| `services/campaignService.ts` | `create` (sort ladder, `spent: 0`, `status: 'live'`), `listMyCampaigns` (own campaigns newest first + one aggregation for `submissionCount` — no N+1), `getCampaignById` / `listCampaignSubmissions` (scoped by `_id` **and** `brand`, so another brand gets a plain 404). |
| `controllers/campaignController.ts` | Thin handlers: guard `req.user`, delegate to the service, respond. No business logic. |
| `routes/campaigns.ts` | `POST /`, `GET /mine`, `GET /:id`, `GET /:id/submissions` — all `authenticate` + `requireRole('brand')`. **Order matters:** `/mine` is registered before `/:id`. Mounted at `/api/campaigns`. |

**Tests (`tests/integration/campaigns.test.ts`, 14 cases in four groups):** create (201, sorted
milestones, `spent: 0`, `remaining = budget`, `status: 'live'`); validation (duplicate thresholds,
non-increasing payouts, budget below the smallest payout, empty ladder, >20 milestones, float
budget — each 400 with `details`); auth/roles (creator 403, no token 401, each brand sees only its
own `/mine`); ownership (another brand's `/:id` and `/:id/submissions` → 404, malformed id → 400,
owner sees an inserted submission with the right DTO shape).

Result: **186 tests passing** (134 unit + 52 integration), coverage gate still 100%,
build + lint clean.

---

## 11. How to run / verify (from `backend/`)

| Command | What it does |
|---|---|
| `npm test` | Runs all unit + integration tests. |
| `npm run test:unit` | Unit tests only. |
| `npm run test:integration` | Integration tests only (in-memory Mongo replica set). |
| `npm run test:coverage` | Tests + coverage; **fails** unless `payout.ts`/`milestones.ts` are 100%. |
| `npm run build` | Compiles TypeScript to `dist/` (catches type errors). |
| `npm run lint` | Style / quality check. |
| `npm run dev` | Starts the API (needs a MongoDB **replica set** reachable at `MONGODB_URI`). |
| `npm start` | Runs the compiled `dist/server.js` (after `npm run build`). |

`GET /health` is live (try `curl http://localhost:4000/health`). The whole API surface is live:
auth (`POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`), brand campaigns
(`POST /api/campaigns`, `GET /api/campaigns/mine`, `GET /api/campaigns/:id`,
`GET /api/campaigns/:id/submissions`), creator endpoints (`GET /api/campaigns`,
`POST /api/submissions`, `GET /api/submissions/mine`, `GET /api/creators/me/earnings`) and the
public `PATCH /api/submissions/:id/views` payout trigger.

Integration tests boot an in-memory MongoDB replica set (`mongodb-memory-server`). The first run
downloads the mongod binary (~330 MB) into `~/.cache/mongodb-binaries`; later runs are fast.

---

## 12. Change cheat-sheet (decision → file)

| If someone asks to change… | Go to |
|---|---|
| Payout amounts, "highest rung" logic | `backend/src/domain/payout.ts` → `calculateEntitledPayout` |
| Budget cap / partial-payout behaviour | `backend/src/domain/payout.ts` → `calculatePayoutDelta` |
| Ladder rules (count, ordering, minimum budget) | `backend/src/domain/milestones.ts` → `validateMilestones` |
| Campaign request validation (name, platform, budget) | `backend/src/validators/campaign.ts` → `createCampaignSchema` |
| Campaign / submission API shapes | `backend/src/services/campaignDto.ts` / `submissionDto.ts` |
| Which URLs are accepted / how links normalize | `backend/src/domain/postUrl.ts` → `validateAndNormalizePostUrl` |
| Spike thresholds / rule | `backend/src/domain/spike.ts` (+ `SPIKE_*` in `env.ts` / `.env.example`) |
| Settings (port, JWT, CORS, DB URL, Redis) | `backend/src/config/env.ts` + `backend/.env.example` |
| The rules themselves (e.g. "make it cumulative") | `docs/MEMED_BUILD_SPEC.md` Decision Log first, **then** the code + tests |

---

## 13. Decisions made (resolved)

- **Instagram `/reel/` vs `/reels/`:** RESOLVED — `/reels/<id>` is canonicalized to `/reel/<id>`, so
  one reel produces exactly one normalized URL (honours D11). Both spellings are still accepted; a
  unit test asserts every variant collapses to `https://instagram.com/reel/XYZ`. The spec's Phase 1
  Instagram task notes this.
- **Docs canonical location:** RESOLVED — the build spec now lives in exactly one place,
  `docs/MEMED_BUILD_SPEC.md`. The old repo-root copy was removed (`git rm`) and all references
  (README, this file) were updated.

---

## 14. What's next

Almost everything in the spec is built. Remaining work (see the spec for detail):

- **Phase 8 (bonus):** the Redis campaign-list cache — `cacheService.ts` is already wired in as a
  no-op hook, so this is additive (`config/redis.ts`, version-key invalidation, `X-Cache` header).
- **Phase 10:** Dockerisation — no `Dockerfile`s or `docker-compose.yml` exist yet.
- **Phase 12 QA leftovers:** the checklist item *"docker compose up works from a clean clone"*
  cannot be ticked until Phase 10 lands. Everything else in the checklist passes (tests, builds,
  coverage, docs).

Phases 0–7, 9 and 11 are complete, and the app is live: the frontend works end to end on Vercel and
the API runs on Render (see the README "Live demo" URLs).

Running the API locally needs a MongoDB **replica set** (e.g. Atlas M0, or any local `mongod`
started with `--replSet`); the test suite uses an in-memory one, so tests need nothing external.

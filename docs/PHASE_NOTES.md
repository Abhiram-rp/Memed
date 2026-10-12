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
| 2 | Database, models, app skeleton | ⏳ Pending |
| 3 | Authentication & authorization | ⏳ Pending |
| 4 | Brand: campaigns | ⏳ Pending |
| 5 | Creator: browse, submit, earnings | ⏳ Pending |
| 6 | Views update & payout engine | ⏳ Pending |
| 7 | Frontend (Next.js) | ⏳ Pending |
| 8 | Bonus: Redis campaign-list cache | ⏳ Pending |
| 9 | Bonus: spike detection | ⏳ Pending |
| 10 | Dockerisation | ⏳ Pending |
| 11 | Deployment (free tiers) | ⏳ Pending |
| 12 | Documentation & final QA | ⏳ Pending |

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
| `routes/` | Map URLs to controllers | no | ❌ (Phase 2+) |
| `controllers/` | Parse/validate the request, send the response | HTTP only | ❌ (Phase 2+) |
| `services/` | Business logic, database access | DB | ❌ (Phase 3+) |
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
│   └── PHASE_NOTES.md       ← this file
├── backend/
│   ├── src/
│   │   ├── config/env.ts    ← reads & validates settings (Phase 0)
│   │   └── domain/          ← THE BRAIN: pure logic (Phase 1)
│   │       ├── payout.ts
│   │       ├── milestones.ts
│   │       ├── postUrl.ts
│   │       └── spike.ts
│   ├── tests/
│   │   ├── unit/            ← Phase 1 tests
│   │   ├── integration/     ← empty (Phase 3+)
│   │   └── setup.ts
│   ├── package.json  tsconfig.json  tsconfig.test.json  jest.config.ts
│   ├── eslint.config.mjs  .prettierrc  .dockerignore  .env.example
└── frontend/                ← empty placeholder (Phase 7)
```

---

## 5. Git branches

| Branch | Contains | Status |
|---|---|---|
| `main` | Phase 0 | Unchanged (merge target) |
| `backend-dev` | Phase 0 + Phase 1 + docs | Pushed to `origin/backend-dev`; awaiting review |

`backend-dev` is meant to be reviewed before merging into `main`.

---

## 6. Phase 0 — Setup & tooling

This phase created the skeleton so code can be written and checked automatically. Nothing runs a
server yet.

| File | What it is, simply |
|---|---|
| `.gitignore` | Tells git to ignore junk: `node_modules`, build output, `.env` secrets, logs. Keeps `.env.example`. |
| `backend/package.json` | Lists the libraries used and the **commands** you run (see §8). |
| `backend/tsconfig.json` | TypeScript rules. `strict: true` makes TS catch many bugs before runtime. `noUncheckedIndexedAccess` makes array access safer. |
| `backend/tsconfig.test.json` | A TS config used only for tests (includes the `tests/` folder). |
| `backend/jest.config.ts` | Test-runner config (Jest). Coverage rules were added here in Phase 1. |
| `backend/eslint.config.mjs` | Style/lint rules (flags unused code, discourages `any`). |
| `backend/.prettierrc` | Auto-formatting rules (single quotes, semicolons, 100-char lines). |
| `backend/.env.example` | Template listing every setting the server needs; copy to `.env` locally. |
| `backend/.dockerignore` | Used in Phase 10 so Docker doesn't copy junk. |
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

### 7.4 `spike.ts` — a placeholder (bonus)

Detects suspiciously fast view growth. Currently a **stub**: it exports the types and a
`detectSpike()` that always returns `{ flagged: false }`. The real rule lands in Phase 9. A spike is
only ever *flagged* — it never blocks or reduces a payout.

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

## 8. How to run / verify (from `backend/`)

| Command | What it does |
|---|---|
| `npm test` | Runs all unit tests (fast). |
| `npm run test:unit` | Unit tests only. |
| `npm run test:integration` | Integration tests (none yet). |
| `npm run test:coverage` | Tests + coverage; **fails** unless `payout.ts`/`milestones.ts` are 100%. |
| `npm run build` | Compiles TypeScript to `dist/` (catches type errors). |
| `npm run lint` | Style / quality check. |
| `npm run dev` | **Not usable yet** — points at `src/server.ts`, which arrives in Phase 2. |

There are **no HTTP endpoints to hit yet** (no `/health`, no auth). The API table in the README is
the *plan*, not live.

---

## 9. Change cheat-sheet (decision → file)

| If someone asks to change… | Go to |
|---|---|
| Payout amounts, "highest rung" logic | `backend/src/domain/payout.ts` → `calculateEntitledPayout` |
| Budget cap / partial-payout behaviour | `backend/src/domain/payout.ts` → `calculatePayoutDelta` |
| Ladder rules (count, ordering, minimum budget) | `backend/src/domain/milestones.ts` → `validateMilestones` |
| Which URLs are accepted / how links normalize | `backend/src/domain/postUrl.ts` → `validateAndNormalizePostUrl` |
| Spike thresholds / rule | `backend/src/domain/spike.ts` (+ `SPIKE_*` in `env.ts` / `.env.example`) |
| Settings (port, JWT, CORS, DB URL, Redis) | `backend/src/config/env.ts` + `backend/.env.example` |
| The rules themselves (e.g. "make it cumulative") | `docs/MEMED_BUILD_SPEC.md` Decision Log first, **then** the code + tests |

---

## 10. Decisions made (resolved)

- **Instagram `/reel/` vs `/reels/`:** RESOLVED — `/reels/<id>` is canonicalized to `/reel/<id>`, so
  one reel produces exactly one normalized URL (honours D11). Both spellings are still accepted; a
  unit test asserts every variant collapses to `https://instagram.com/reel/XYZ`. The spec's Phase 1
  Instagram task notes this.
- **Docs canonical location:** RESOLVED — the build spec now lives in exactly one place,
  `docs/MEMED_BUILD_SPEC.md`. The old repo-root copy was removed (`git rm`) and all references
  (README, this file) were updated.

---

## 11. What's next

Still to build, in order (see the spec for detail):

- **Phase 2:** MongoDB models, Express app, first route `GET /health`.
- **Phase 3:** signup / login / JWT auth.
- **Phase 4:** brand campaign endpoints.
- **Phase 5:** creator browse / submit / earnings.
- **Phase 6:** the `PATCH /api/submissions/:id/views` endpoint running payout math in a DB
  transaction.
- **Phase 7:** frontend. **Phase 8:** Redis cache. **Phase 9:** real spike detection.
  **Phase 10:** Docker. **Phase 11:** deploy. **Phase 12:** docs & final QA.

Phase 2 will need a MongoDB **replica set** (Atlas M0 or the Docker compose Mongo) for the eventual
transactions; until then all tests run with no database.

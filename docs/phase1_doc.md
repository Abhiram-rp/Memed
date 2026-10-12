# Phase 1 — Domain Core (Pure Logic) + Unit Tests

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 4, 6, 8); this doc explains the *code*.

## What this phase delivers

The "brain" of the product — pure functions with **no I/O** (no database, no network, no
HTTP). Everything money-related in the app is computed here and nowhere else.

- `payout.ts` — the payout mathematics (spec §6.1).
- `milestones.ts` — milestone ladder normalization + validation (D8, D9).
- `postUrl.ts` — post URL validation + canonicalization (D11).
- `spike.ts` — a stub with the stable type/signature (implemented in Phase 9).
- Unit tests for all of the above.

**Exit criteria met:** all unit tests green; **100% line/branch coverage** on `payout.ts`
and `milestones.ts` (enforced by `npm run test:coverage`).

**Commits:** `24972ca` (payout), `f1b6c83` (payout tests), `5de5201` (milestones),
`b899ba8` (postUrl), `ba2a33e` (spike stub), `cbadb60` (canonicalize `/reels/` → `/reel/`).

---

## Deep dive — `backend/src/domain/payout.ts`

### `interface Milestone`

```ts
export interface Milestone {
  views: number;   // view threshold at which this payout becomes the entitled amount
  payout: number;  // integer rupee amount paid once the threshold is reached
}
```

One rung of a campaign's ladder. **All money is an integer number of rupees** (D1) and all
view counts are non-negative integers.

### `assertNonNegativeInteger(value, name)`

```ts
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received ${String(value)}`);
  }
}
```

Throws `RangeError` for anything that is not a non-negative integer (floats, negatives,
`NaN`, `Infinity`). Every public function validates its inputs this way — the domain never
silently accepts garbage.

### `calculateEntitledPayout(views, milestones)`

```ts
export function calculateEntitledPayout(views: number, milestones: readonly Milestone[]): number {
  assertNonNegativeInteger(views, 'views');
  const ascending = [...milestones].sort((a, b) => a.views - b.views);
  let entitled = 0;
  for (const milestone of ascending) {
    if (milestone.views > views) break;
    entitled = milestone.payout;
  }
  return entitled;
}
```

- **Payout of the highest milestone whose threshold is reached** (`threshold <= views`), or
  `0` when none is reached.
- Milestones are **not cumulative** (D2): crossing several rungs in one update pays the
  highest rung only. Example: ladder 10K→500, 50K→2,000, 100K→5,000; at 60,000 views the
  entitled payout is **2,000** (not 500+2,000).
- The ladder is **sorted on a copy** (`[...milestones]`), so an unsorted ladder still works
  and the caller's array is never mutated.
- The loop breaks at the first threshold above `views` (the array is sorted ascending), so
  the last assigned `entitled` is the highest reached rung.

### `DeltaInput` / `DeltaResult`

```ts
export interface DeltaInput {
  entitledAmount: number;  // high-water entitlement for the submission (never decreases, D5)
  alreadyPaid: number;     // amount already paid to the submission
  remainingBudget: number; // budget - spent for the campaign, always >= 0
}

export interface DeltaResult {
  delta: number;  // amount payable now: clamp(entitledAmount - alreadyPaid, 0, remainingBudget)
  capped: boolean; // true when the submission is owed more than it can be paid
}
```

### `calculatePayoutDelta(input)`

```ts
const owed = Math.max(entitledAmount - alreadyPaid, 0);
const delta = Math.min(owed, remainingBudget);
const capped = alreadyPaid + delta < entitledAmount;
return { delta, capped };
```

- `owed` = the unpaid part of the entitlement (never negative — no clawback, D6).
- `delta` = what can actually be paid now, capped by the remaining budget (D3/D4).
- `capped` = after this payment the submission is still owed money (budget ran out).
  Note the exact-equality edge: if `alreadyPaid + delta === entitledAmount`, the submission
  is fully paid and `capped` is `false`.

---

## Deep dive — `backend/src/domain/milestones.ts`

### Types and constants

```ts
export interface MilestoneInput { views: number; payout: number; }        // as supplied by a client
export interface MilestoneValidationError { path: string; message: string; } // JSON-path style
export type MilestoneValidationResult =
  | { ok: true; milestones: Milestone[] }
  | { ok: false; errors: MilestoneValidationError[] };

export const MIN_MILESTONES = 1;
export const MAX_MILESTONES = 20;
```

The `{ path, message }` error shape is designed to be consumed by the zod layer (Phase 4
turns these into the API's `details` array).

### `normalizeMilestones(input)`

```ts
return input
  .map((m) => ({ views: m.views, payout: m.payout }))  // copy each object
  .sort((a, b) => a.views - b.views);                  // ascending by views (D8)
```

Returns a **new** sorted ladder; neither the input array nor its objects are mutated
(the `.map` copies each object before sorting). Does not validate — call
`validateMilestones` first.

### `validateMilestones(input, budget)`

Validates per D8 + D9 and returns **every problem at once** (not just the first):

1. **Budget** must be a positive integer → error at path `budget`.
2. **Count** must be between `MIN_MILESTONES` and `MAX_MILESTONES` → error at path
   `milestones`.
3. **Each milestone**: `views` and `payout` must be positive integers → errors at
   `milestones.<i>.views` / `milestones.<i>.payout`.
4. If any of the above failed, return early (sorting garbage is pointless).
5. **Sort** a copy ascending by views, then check **strictly increasing**:
   - `current.views <= previous.views` → error `milestones.<i>.views` (duplicate thresholds
     rejected — two rungs can't trigger at the same view count);
   - `current.payout <= previous.payout` → error `milestones.<i>.payout` (a higher rung must
     pay more).
6. **Budget ≥ smallest payout** (D9): `budget < lowestPayout` → error at `budget`.

On success it returns the **sorted, normalized ladder** so callers store it without a
second pass.

---

## Deep dive — `backend/src/domain/postUrl.ts`

### Types

```ts
export type Platform = 'instagram' | 'youtube';
export type PostUrlResult = { ok: true; normalized: string } | { ok: false; reason: string };
```

### Constants

```ts
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const INSTAGRAM_POST_TYPES = new Set(['p', 'reel', 'reels', 'tv']);
const INSTAGRAM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
```

### Helpers

- `parseUrl(rawUrl)` — `new URL(rawUrl.trim())` in a try/catch; returns `null` on malformed
  input. (Trimming happens here, which is why `'  https://…  '` works.)
- `splitPath(pathname)` — splits on `/` and drops empty segments, so
  `/p/ABC123/` → `['p', 'ABC123']`.

### `normalizeInstagram(url)`

1. Host must be in `INSTAGRAM_HOSTS` (case-insensitive).
2. Path must be exactly 2 segments (`/<type>/<id>`) or 3 (`/<username>/<type>/<id>`).
3. `type` must be one of `p | reel | reels | tv`; `id` must match `INSTAGRAM_ID_PATTERN`.
4. **Canonicalization:** `/reels/<id>` is an alias of `/reel/<id>`, so
   `canonicalType = type === 'reels' ? 'reel' : type`.
5. Returns `https://instagram.com/<canonicalType>/<id>` — lowercase host, no `www`, no
   username, no query/hash/trailing slash, **id case preserved**.

Why this matters (D11): `normalizedUrl` is globally unique in the database, so
`instagram.com/reel/XYZ` and `instagram.com/reels/XYZ` must collapse to the **same string**
or the same reel could be submitted twice.

### `normalizeYouTube(url)`

1. Host must be in `YOUTUBE_HOSTS`.
2. **`youtu.be/<id>`** — one path segment, id must match `YOUTUBE_ID_PATTERN`.
3. **`/watch?v=<id>`** — `segments[0] === 'watch'`, id from the `v` query param.
4. **`/shorts/<id>`** — id from the second segment.
5. All three normalize to **`https://youtube.com/watch?v=<id>`** — so a Short and its
   `watch` URL are the same video and cannot be double-submitted.

### `validateAndNormalizePostUrl(rawUrl, platform)`

The single public entry point:

1. Parse the URL (trimmed); `null` → `{ ok: false, reason: 'URL is missing or malformed' }`.
2. Protocol must be `http:` or `https:` (rejects `ftp:`, `javascript:`, `file:`, …).
3. Dispatch to `normalizeInstagram` or `normalizeYouTube` based on `platform`.

---

## Deep dive — `backend/src/domain/spike.ts`

A **stub** (bonus feature, D15). It exports the stable types (`SpikeInput`,
`SpikeThresholds`, `SpikeResult`), `DEFAULT_SPIKE_THRESHOLDS`, and
`detectSpike(_input, _thresholds)` which always returns `{ flagged: false }`. The real rule
(`increase >= minDelta AND ratePerMin >= threshold`) lands in Phase 9. The Phase 6
view-update service will call this function, so the signature must not change.

---

## The tests

### `tests/unit/payout.test.ts`

- **`calculateEntitledPayout`** — table-driven boundary cases (0, 9,999, 10,000, 49,999,
  50,000, 99,999, 100,000, 10,000,000); single-milestone ladder; unsorted ladder gives the
  same result as sorted; input ladder is **not mutated** (`structuredClone` snapshot);
  empty ladder → 0; `RangeError` for `-1, -10_000, 0.5, 1.5, NaN, Infinity`.
- **`calculatePayoutDelta`** — pays the unpaid difference; pays nothing when fully paid;
  caps at remaining budget with `capped: true`; empty budget → `delta 0, capped true`;
  exact-equality edge → `capped: false`; `alreadyPaid > entitledAmount` → `delta 0`;
  `RangeError` for negative/non-integer inputs; and a **deterministic property test**
  (seeded mulberry32 PRNG, 800 simulated updates across 5 submissions) asserting the
  invariants: `delta >= 0`, `paid <= entitled`, `totalPaid <= budget`, `remaining >= 0`,
  and `capped ⇒ paid < entitled`.

### `tests/unit/milestones.test.ts`

- `normalizeMilestones` sorts ascending, returns a new array, mutates nothing.
- `validateMilestones` — accepts valid/unsorted/single ladders; rejects empty and >20
  ladders; accepts exactly 20; rejects duplicate thresholds (`milestones.1.views`),
  non-increasing payouts (`milestones.1.payout`), non-positive/non-integer
  views/payout/budget, budget < smallest payout; reports **every problem at once**
  (`{ views: 0, payout: 0 }` with budget 0 yields ≥ 3 errors).

### `tests/unit/postUrl.test.ts`

- Instagram: 4 URL variants normalize to one canonical form; id case preserved; `/reels/`
  alias + username prefix collapse to `/reel/`; malformed paths rejected
  (`/explore/`, `/p/`, `/stories/`, 4-segment paths, invalid id chars); YouTube URL
  rejected on the Instagram platform.
- YouTube: `watch`, `shorts`, `youtu.be` (with/without query) all normalize to
  `https://youtube.com/watch?v=<id>`; malformed links rejected (`/watch` without `v`,
  short ids, `/embed/`, `music.youtube.com`); Instagram URL rejected on YouTube.
- General: empty/whitespace/garbage URLs rejected; non-http(s) protocols rejected
  (`ftp:`, `javascript:`, `file:`); failure returns a human-readable `reason`; surrounding
  whitespace is trimmed.

---

## How to change things in Phase 1

| You want to… | Do this |
|---|---|
| Change payout amounts / "highest rung" logic | `src/domain/payout.ts` → `calculateEntitledPayout` (and its tests). |
| Change budget-cap / partial-payout behaviour | `src/domain/payout.ts` → `calculatePayoutDelta` (and its tests). |
| Change ladder rules (count, ordering, min budget) | `src/domain/milestones.ts` → `MIN/MAX_MILESTONES`, `validateMilestones` (and its tests). |
| Accept a new URL shape (e.g. `instagram.com/stories/`) | `src/domain/postUrl.ts` → `INSTAGRAM_POST_TYPES` / `normalizeInstagram` (and tests). |
| Add a whole new platform | Add the host set + a `normalizeX` function + a branch in `validateAndNormalizePostUrl`, extend `Platform`, and update the `Campaign` model enum (Phase 2). |
| Change the canonical URL form | Edit the template strings in `normalizeInstagram` / `normalizeYouTube` — **and** the tests, which assert the exact strings. |
| Implement spike detection | `src/domain/spike.ts` (Phase 9) — keep the exported signature. |

> Rule of thumb: the domain is pure. If a change needs a database, HTTP, or a clock, it
> belongs in a service (Phase 3+) or middleware, not here.
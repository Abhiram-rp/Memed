# Phase 6 — Views Update & Payout Engine

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 4.4, 5.4, 6.1–6.3, 7 Phase 6); this doc explains the *code*.

## What this phase delivers

A platform (or the demo "simulate views" control) can now report a submission's view count,
and the payout engine moves money safely:

- `PATCH /api/submissions/:id/views` → `200 { submission, payout, campaign }` — **no auth**
  (D13), body `{ views }` is the **absolute** current count.
- `viewsParamsSchema` — params validation (`{ id: ObjectId }`, reuses `objectIdParamSchema`).
- `updateViewsBodySchema` — body validation (`views` integer `0..2_000_000_000`, `.strict()`).
- `updateViews()` — the transactional payout engine: one MongoDB transaction, a compare-and-set
  guard on `campaign.spent`, high-water entitlement, no clawback, and the `exhausted` status flip
  in the same write.
- `invalidateCampaignCache()` — the post-commit cache hook (a deliberate no-op until Phase 8).
- `Model.init()` in the test DB helper so the unique indexes exist before the suites run.
- 1 unit suite (12 tests) + 1 integration suite (16 tests in four groups).

**Exit criteria met:** every worked example in §6.3 passes as an integration test, and the §4.4
invariants hold under concurrency (20 parallel updates on a tight budget never overspend; 10
identical parallel updates pay exactly once).

**Commits:** `384f299` (replica-set helper + cache hook), `28bfdb4` (views validation schemas),
`5712389` (transactional view update with budget cap), `ca2942b` (ladder + skipped milestones),
`193dbd8` (idempotency, decreasing views, error cases), `7d4c157` (budget exhaustion and partial
payouts), `dc7af45` (concurrency and idempotency under parallel updates).

---

## Deep dive — `backend/src/validators/submission.ts`

Phase 5 created `createSubmissionSchema`; Phase 6 added the two schemas for the views route:

```ts
import { objectIdParamSchema, objectIdSchema } from './common';

/** Largest absolute view count a platform update may report (spec §5.4). */
export const MAX_VIEWS = 2_000_000_000;

/** Params schema for `PATCH /api/submissions/:id/views` (spec Phase 6 task 1). */
export const viewsParamsSchema = objectIdParamSchema;

export type ViewsParams = z.infer<typeof viewsParamsSchema>;

export const updateViewsBodySchema = z
  .object({
    views: z
      .number()
      .int('views must be an integer')
      .min(0, 'views must be at least 0')
      .max(MAX_VIEWS, `views must be at most ${MAX_VIEWS}`),
  })
  .strict();

export type UpdateViewsBody = z.infer<typeof updateViewsBodySchema>;
```

- **`viewsParamsSchema` is just `objectIdParamSchema`** — the shared `{ id: ObjectId }` schema
  from `common.ts`. A malformed id becomes a 400 `VALIDATION_ERROR` **before** any DB call, so a
  bad id never produces a Mongoose `CastError`.
- **`z.number()`, not `z.coerce.number()`**: `views` arrives in a JSON body, so it must already be
  a number. A numeric string `"500"` is rejected (no coercion), which the tests assert.
- **`.int()` rejects floats**, `.min(0)` rejects negatives, `.max(MAX_VIEWS)` rejects
  `2_000_000_001`. `z.number()` also rejects `NaN` and `null`.
- **`.strict()` refuses unknown keys**, so `{ views: 10, extra: true }` is a 400 rather than being
  silently ignored.
- `MAX_VIEWS` is exported so the tests and any future caller share the one constant.

## Deep dive — `backend/src/services/viewUpdateService.ts`

The heart of the phase. It is the only place that moves money, and it does so inside a single
MongoDB transaction (D7) so concurrent updates can never overspend a budget or double-pay.

### The result types (spec §5.4)

```ts
export interface ViewUpdatePayout {
  previousPaid: number;   // paidAmount before this update
  delta: number;          // clamp(entitledAmount - previousPaid, 0, remaining)
  paidAmount: number;     // paidAmount after this update
  entitledAmount: number; // high-water entitlement after this update (never decreases, D5)
  capped: boolean;        // still owed more than the budget allowed
}

export interface ViewUpdateCampaign {
  id: string;
  budget: number;
  spent: number;
  remaining: number;
  status: CampaignStatus;
}

export interface ViewUpdateResult {
  submission: SubmissionLike; // plain object accepted by toSubmissionDTO (carries the campaign)
  payout: ViewUpdatePayout;
  campaign: ViewUpdateCampaign;
}
```

### `updateViews(submissionId, views)`

```ts
export async function updateViews(submissionId: string, views: number): Promise<ViewUpdateResult> {
  const session = await mongoose.startSession();
  // `withTransaction`'s own return value varies between driver versions, so the
  // callback assigns to this outer variable instead. Each retry re-assigns it.
  let result: ViewUpdateResult | undefined;

  try {
    await session.withTransaction(async () => {
      // Fresh reads every attempt: the callback may re-run on a transient retry.
      const submission = await Submission.findById(submissionId).session(session);
      if (!submission) {
        throw new NotFoundError('Submission not found');   // aborts, NOT retried
      }

      const campaign = await Campaign.findById(submission.campaign).session(session);
      if (!campaign) {
        throw new NotFoundError('Campaign not found');
      }

      const now = new Date();

      const newEntitled = Math.max(
        submission.entitledAmount,
        calculateEntitledPayout(views, campaign.milestones),
      );
      const remaining = campaign.budget - campaign.spent;
      const { delta, capped } = calculatePayoutDelta({
        entitledAmount: newEntitled,
        alreadyPaid: submission.paidAmount,
        remainingBudget: remaining,
      });

      // Bonus flag only (D15): it never changes or blocks a payout.
      const spike = detectSpike(
        {
          previousViews: submission.views,
          newViews: views,
          previousUpdatedAt: submission.lastViewsUpdatedAt,
          now,
        },
        { minDelta: env.SPIKE_MIN_DELTA, ratePerMin: env.SPIKE_RATE_PER_MIN },
      );

      const previousPaid = submission.paidAmount;

      // ALWAYS write the submission: this write serializes concurrent updates on
      // the same document (the Mongo write conflict makes the loser retry).
      submission.views = views;
      submission.entitledAmount = newEntitled;
      submission.paidAmount = previousPaid + delta;
      submission.lastViewsUpdatedAt = now;
      if (spike.flagged && !submission.flagged) {
        submission.flagged = true;
        submission.flagReason = spike.reason ?? 'Unusually fast view growth';
        submission.flaggedAt = now;
      }
      await submission.save({ session });

      let newSpent = campaign.spent;
      if (delta > 0) {
        newSpent = campaign.spent + delta;
        const newStatus: CampaignStatus = newSpent === campaign.budget ? 'exhausted' : 'live';
        // Compare-and-set on the exact `spent` we read: if another transaction
        // already moved it, matchedCount is 0 and we abort to retry (§6.2).
        const updated = await Campaign.updateOne(
          { _id: campaign._id, spent: campaign.spent },
          { $set: { spent: newSpent, status: newStatus } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new Error('Concurrent campaign update');
        }
      }

      const newStatus: CampaignStatus = newSpent === campaign.budget ? 'exhausted' : 'live';

      const submissionView = {
        ...submission.toObject(),
        campaign: { _id: campaign._id, name: campaign.name, platform: campaign.platform },
      };

      result = {
        submission: submissionView,
        payout: { previousPaid, delta, paidAmount: previousPaid + delta, entitledAmount: newEntitled, capped },
        campaign: {
          id: campaign._id.toString(),
          budget: campaign.budget,
          spent: newSpent,
          remaining: campaign.budget - newSpent,
          status: newStatus,
        },
      };
    });

    const resolved = result;
    if (resolved === undefined) {
      throw new Error('View update transaction resolved without producing a result');
    }

    // Cache problems must never fail a payout (spec Phase 6 task 6).
    try {
      await invalidateCampaignCache();
    } catch (err) {
      logger.warn('Failed to invalidate the campaign cache after a view update', err);
    }

    return resolved;
  } finally {
    await session.endSession();
  }
}
```

Step by step:

1. **One session, one transaction.** `mongoose.startSession()` + `session.withTransaction(...)`
   (D7). `withTransaction` **auto-retries** the callback on a `TransientTransactionError` (a
   write conflict), which is what makes the concurrency tests pass.
2. **The return value is not relied on.** The driver's `withTransaction` return type varies
   between versions, so the callback assigns to the outer `result` variable and the function
   returns that. If the callback somehow never ran, `result` stays `undefined` and we throw
   rather than return a half-built object.
3. **Fresh reads inside the callback.** Every attempt re-reads the submission and campaign with
   `.session(session)`, because the callback may re-run on a retry. No state is carried in from
   outside except the `result` we assign at the end.
4. **404 is a domain error.** `NotFoundError` thrown inside the callback aborts the transaction
   and propagates; it is **not** retried (only transient errors are).
5. **High-water entitlement (D5).** `newEntitled = max(submission.entitledAmount,
   calculateEntitledPayout(views, campaign.milestones))`. A decrease in `views` is stored, but the
   entitlement never drops — so there is **no clawback** and a decrease can never produce a
   negative delta.
6. **All payout math comes from the domain.** `calculateEntitledPayout` and `calculatePayoutDelta`
   (in `domain/payout.ts`) are the only source of the entitled amount and the delta. This service
   never computes a payout itself.
7. **The submission write is load-bearing.** The submission is written on **every** update, even
   when `delta === 0`. That write is what serializes two concurrent updates on the same
   submission: the loser hits a Mongo write conflict and `withTransaction` retries it, so the
   second attempt sees the first attempt's `paidAmount` and pays `delta = 0` (D6).
8. **Compare-and-set on `campaign.spent`.** When `delta > 0`, the campaign is updated with
   `updateOne({ _id, spent: campaign.spent }, { $set: { spent: newSpent, status: newStatus } })`.
   The filter pins the exact `spent` we read; if another transaction already moved it,
   `matchedCount` is `0` and we throw to abort and retry. This is the guard that stops two
   submissions from both spending the last of a budget.
9. **Status flips in the same write (task 4).** `status` is set to `'exhausted'` exactly when
   `newSpent === campaign.budget`, in the **same** `$set` as `spent` — so `spent` and `status` can
   never disagree. When `delta === 0`, `newSpent` is unchanged and the status is recomputed from
   the current `spent` for the response only.
10. **The response carries a plain object.** `submission.toObject()` is spread and its `campaign`
    reference is replaced with `{ _id, name, platform }`, so `toSubmissionDTO` can embed the
    campaign summary (§5.4) without a second query.
11. **Cache invalidation after commit (task 6).** `invalidateCampaignCache()` runs **after** the
    transaction commits, wrapped in `try/catch` so a cache problem can never fail a payout. It is
    a no-op until Phase 8.
12. **`finally` always ends the session.**

> Note: the spec's §6.2 pseudocode returns the object from the callback; the implementation
> assigns to an outer variable instead (point 2) because the driver's return type is not stable.

## Deep dive — `backend/src/services/cacheService.ts`

```ts
/**
 * Campaign cache invalidation hook.
 * ... Real Redis caching is a Phase 8 bonus (`config/redis.ts`, key space
 * `campaigns:live:*`) and the app must work with no Redis present.
 * Until Phase 8 this is a deliberate no-op ...
 */
export async function invalidateCampaignCache(): Promise<void> {
  // Intentionally empty — Phase 8 bumps `campaigns:live:version` here.
}
```

- **A stable call site now, the real work later.** Phase 6 only needs the hook to exist and be
  called after a committed update; Phase 8 fills in the `INCR campaigns:live:version`.
- **No Redis code exists yet** — no `config/redis.ts`, no `ioredis` import. The app runs with no
  Redis present.

## Deep dive — `backend/src/controllers/submissionController.ts`

```ts
/**
 * PATCH /api/submissions/:id/views — thin handler (spec §5.4). This route has
 * NO auth by decision D13, so a platform can report view counts. The route
 * chain already validated the params and body.
 */
export async function updateViews(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const { views } = req.body as UpdateViewsBody;
  const result = await updateViewsRecord(id, views);
  res.status(200).json({
    submission: toSubmissionDTO(result.submission),
    payout: result.payout,
    campaign: result.campaign,
  });
}
```

- **Thin handler (spec §9):** the route chain already ran `validate(viewsParamsSchema, 'params')`
  and `validate(updateViewsBodySchema, 'body')`, so the handler just reads the parsed values,
  delegates to the service, and renders the §5.4 shape.
- **No `req.user` guard** — unlike the other handlers in this file, this route is public (D13), so
  there is no `UnauthenticatedError` branch.
- `req.params.id as string` / `req.body as UpdateViewsBody` are safe because the middleware
  guarantees the shapes; the casts satisfy `@types/express`'s looser `Request` types.
- The saved submission goes through `toSubmissionDTO`, so `_id`/`__v`/`normalizedUrl` never leak
  (D18).

## Deep dive — `backend/src/routes/submissions.ts`

```ts
// `/mine` is registered before any `/:id` route so the id matcher never swallows it.
router.get('/mine', authenticate, requireRole('creator'), asyncHandler(listMySubmissions));

router.post('/', authenticate, requireRole('creator'), validate(createSubmissionSchema, 'body'), asyncHandler(createSubmission));

// Public by decision D13: no `authenticate`, no `requireRole`.
router.patch(
  '/:id/views',
  validate(viewsParamsSchema, 'params'),
  validate(updateViewsBodySchema, 'body'),
  asyncHandler(updateViews),
);
```

- **No `authenticate`, no `requireRole`** on the PATCH route (D13) — the only public write in the
  API. The security implication is documented in the README.
- **Params are validated before the body**, so a malformed id is a 400 even if the body is also
  bad.
- **Route order still matters:** `/mine` stays registered before the `/:id` routes so the literal
  path is never captured as an id.
- Mounted in `app.ts`: `app.use('/api/submissions', submissionsRouter)`.

## Deep dive — `backend/tests/helpers/mongo.ts`

```ts
export async function setupTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Build indexes up front so the unique indexes (D11: User.email,
  // Submission.normalizedUrl) exist before duplicate-key tests run.
  await Promise.all([User.init(), Campaign.init(), Submission.init()]);
}
```

- **`Model.init()` builds the indexes up front.** The helper already used `MongoMemoryReplSet`
  (a replica set is required for transactions, D7); Phase 6 added the `init()` calls so the unique
  indexes exist before any suite runs.
- The rest is unchanged: `clearTestDb()` wipes collections between tests, `teardownTestDb()`
  disconnects and stops the replica set.

## Deep dive — `backend/src/domain/payout.ts` and `backend/src/domain/spike.ts` (unchanged)

- **`domain/payout.ts` is untouched this phase.** `calculateEntitledPayout` (highest reached
  milestone only, D2) and `calculatePayoutDelta` (`clamp(entitled − paid, 0, remaining)`, D3/D4)
  were written in an earlier phase and are the **only** payout math in the app. Phase 6 just calls
  them from inside the transaction.
- **`domain/spike.ts` is still the stub.** `detectSpike` returns `{ flagged: false }`
  unconditionally; the Phase 9 rule is not implemented. The service already calls it and stores
  `flagged`/`flagReason`/`flaggedAt` once, but flagging never blocks or reduces a payout (D15).

---

## The tests

Setup mirrors the other suites: `setupTestDb()` + `Model.init()` (builds the unique indexes),
`clearTestDb()` between tests, `teardownTestDb()` at the end. The integration suite uses
`jest.setTimeout(60000)` because the concurrency tests run many transactions.

**Unit — `tests/unit/viewsSchema.test.ts` (12)**

- `updateViewsBodySchema` (10): accepts `0` and `2_000_000_000`; rejects `2_000_000_001`, `-1`,
  `1.5`, `"500"` (no coercion), `null`, `NaN`, a missing `views`, and an unknown extra key.
- `viewsParamsSchema` (2): accepts a valid ObjectId; rejects a bad id.

**Integration — `tests/integration/viewUpdate.test.ts` (16, four groups)**

- **Group 1 — walks the milestone ladder** (2): the §6.3 ladder `0 → 9,999 → 10,000 → 49,999 →
  50,000 → 99,999 → 100,000 → 10,000,000` pays `0, 0, 500, 500, 2000, 2000, 5000, 5000` with the
  matching deltas and `campaign.spent`, asserting the §4.4 invariants after **every** call; and
  skipping two milestones (`0 → 60,000`) pays `2,000`, not `2,500` (D2).
- **Group 2 — idempotency, monotonic payouts and validation** (7): repeating the same PATCH pays
  `delta 0` the second time (D6); a views decrease stores the new count but keeps
  `entitledAmount`/`paidAmount` and pays `delta 0`, then climbing again pays only the difference
  (D5); unknown-but-valid id → 404 `NOT_FOUND`; malformed id → 400; invalid bodies (`"500"`,
  `1.5`, `-1`, `null`, missing, `2_000_000_001`) → 400 with nothing written; no `Authorization`
  header required (D13); an already-exhausted campaign still accepts an update (views stored,
  `delta 0`).
- **Group 3 — budget cap, shared budget and concurrency** (4): a payout is capped at the remaining
  budget and marked `capped` (D4); one budget drains across several submissions (the exact-fit
  payout is **not** capped, the next pays `0`); 20 parallel updates on a tight budget never
  overpay; 10 identical parallel updates pay exactly once (D6).
- **Group 4 — concurrency races never overspend or double-pay** (3): an **overspend race** (budget
  `1200`, 20 submissions each entitled to `2000`, fired in parallel) settles at exactly `spent
  1200`, `status exhausted`, `Σ paidAmount === 1200`, no submission above `2000`; a **double-pay
  race** (10 identical parallel PATCHes) pays exactly once (`paidAmount 500`, one `delta 500`, nine
  `delta 0`); a **mixed race** (`1000, 5000, 1000, 5000, 1000` in parallel) settles on the
  high-water entitlement (`entitledAmount 2000`, `paidAmount 2000`, `spent 2000`) with every
  response `delta ≥ 0`.

Result: **252 tests passing** across 20 suites; build and lint clean; `domain/payout.ts` and
`domain/milestones.ts` at 100% coverage.

---

## How to change things in Phase 6

| You want to… | Do this |
|---|---|
| Change the max view count | `src/validators/submission.ts` → `MAX_VIEWS` (and the unit test). |
| Change the views body rules (e.g. allow coercion) | `src/validators/submission.ts` → `updateViewsBodySchema`. |
| Change the payout math | `src/domain/payout.ts` → `calculateEntitledPayout` / `calculatePayoutDelta` (never inline it in the service). |
| Change the entitlement rule (e.g. cumulative) | `src/domain/payout.ts` → `calculateEntitledPayout` (D2) — and the service's `Math.max` high-water line. |
| Change the budget-cap behaviour | `src/domain/payout.ts` → `calculatePayoutDelta` (D4). |
| Change the concurrency guard | `src/services/viewUpdateService.ts` → the `Campaign.updateOne({ _id, spent }, …)` compare-and-set. |
| Change when a campaign becomes `exhausted` | `src/services/viewUpdateService.ts` → the `newSpent === campaign.budget` status line (keep it in the same `$set` as `spent`). |
| Change the response shape | `src/services/viewUpdateService.ts` (`ViewUpdateResult`) + `src/controllers/submissionController.ts` → `updateViews`. |
| Make the route authenticated | `src/routes/submissions.ts` → add `authenticate` (and `requireRole`) to the PATCH chain — but that reverses D13. |
| Implement the cache invalidation | `src/services/cacheService.ts` → `invalidateCampaignCache` (Phase 8). |
| Implement spike detection | `src/domain/spike.ts` → `detectSpike` (Phase 9); the service already calls it. |

> Rule of thumb: routes/middleware never touch the domain math; services call the domain and the
> database; controllers stay thin. Keep that layering and changes stay local.

---

## How the pieces connect (request flow)

```
PATCH /api/submissions/:id/views
  → validate(viewsParamsSchema, 'params')   (400 on a malformed id)
  → validate(updateViewsBodySchema, 'body') (400 on a bad/extra/missing views; body replaced)
  → updateViews                             (NO auth — D13)
      → startSession + withTransaction      (auto-retries transient write conflicts, D7)
          → read submission (404 if missing) and campaign
          → newEntitled = max(prev, calculateEntitledPayout(views, milestones))   (D5)
          → { delta, capped } = calculatePayoutDelta({ newEntitled, paid, remaining })  (D3/D4)
          → detectSpike(...)                (bonus flag only; never blocks a payout, D15)
          → save submission                 (always — serializes same-submission updates, D6)
          → if delta > 0: CAS updateOne({ _id, spent }, { $set: { spent, status } })  (D4)
      → after commit: invalidateCampaignCache()   (no-op until Phase 8)
  → 200 { submission, payout, campaign }
```

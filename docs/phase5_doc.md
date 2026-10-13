# Phase 5 — Creator: Browse Campaigns, Submit Posts, Earnings

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 5.1–5.3, 7 Phase 5, tasks 1–5); this doc explains the *code*.

## What this phase delivers

A creator can now browse live campaigns, submit a post, and read their earnings:

- `GET /api/campaigns` → `200 { items, page, limit, total }` (creator only; `status: 'live'`
  only, newest first, paginated)
- `GET /api/campaigns/:id` → `200 { campaign }` (brand **owner** or **creator**; a creator
  gets a live campaign only, otherwise 404)
- `POST /api/submissions` → `201 { submission }` (creator only)
- `GET /api/submissions/mine` → `200 { items }` (creator only; own submissions newest first,
  campaign `name`/`platform` embedded)
- `GET /api/creators/me/earnings` → `200 { earnings }` (creator only)
- `paginationQuerySchema` — query validation (`page` ≥ 1 default 1, `limit` 1–100 default 20)
- `createSubmissionSchema` — body validation (`campaignId` ObjectId, `postUrl` 1–2048 chars)
- `listLive()` — the paginated creator campaign list
- `createSubmission()` / `listMySubmissions()` — the submit and "my submissions" services
- `getCreatorEarnings()` — one `$group` aggregation with a `byCampaign` breakdown
- 7 integration suites + 2 unit suites (50 new tests).

**Exit criteria met:** creator can browse, submit, and view earnings via API.

**Commits:** `5b28088` (list live campaigns), `ee69e26` (create submission schema), `66fdad5`
(submit post with URL validation), `c519ea7` (create submission integration tests), `ad952ac`
(list my submissions), `b13373b` (earnings endpoint), `c93a43c`/`cd8bf0e`/`b2abf38`/`e298a4c`
(the four-group integration suites), `a53a25f` (final cleanup).

---

## Deep dive — `backend/src/validators/common.ts`

The shared `objectIdSchema` already existed (Phase 4). Phase 5 added the pagination query schema:

```ts
/** Pagination query parameters for list endpoints. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
```

- **`z.coerce.number()`, not `z.number()`**: query-string values arrive as strings, so
  `?page=2` must be coerced. `.int()` still rejects `2.5`, and `.min(1)` rejects `0`.
- **Defaults are the spec's** (task 1): `page` 1, `limit` 20; the hard cap is 100.
- Because the middleware runs `validate(paginationQuerySchema, 'query')`, an over-limit `limit`
  becomes a 400 `VALIDATION_ERROR` before the controller runs.

## Deep dive — `backend/src/validators/submission.ts`

```ts
import { z } from 'zod';
import { objectIdSchema } from './common';

export const createSubmissionSchema = z.object({
  campaignId: objectIdSchema,
  postUrl: z.string().trim().min(1, 'postUrl is required').max(2048, 'postUrl is too long'),
});

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
```

- Only structural checks live here; the *platform* check needs the campaign, so it runs in the
  service via `validateAndNormalizePostUrl` (spec task 2).
- `campaignId` reuses `objectIdSchema`, so a malformed id is a 400 before any DB call.
- `postUrl` is bounded (1–2048) and trimmed; the service then trims again and normalizes.

## Deep dive — `backend/src/services/campaignService.ts` (`listLive`, `getCampaignByIdForCreator`)

### `listLive(page, limit)`

```ts
export async function listLive(page: number, limit: number): Promise<LiveCampaignsResult> {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Campaign.find({ status: 'live' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('name platform budget spent status milestones createdAt brand')
      .populate('brand', 'name')
      .lean(),
    Campaign.countDocuments({ status: 'live' }),
  ]);

  return {
    items: items.map((campaign) => toCampaignDTO(campaign)),
    page,
    limit,
    total,
  };
}
```

- **`status: 'live'` only** (spec task 1); an exhausted campaign never appears.
- **Newest first** (`createdAt: -1`), paginated with `skip`/`limit`.
- **The page + count are fetched with `Promise.all`** — one query for the page, one for `total`,
  in parallel.
- **`.lean()` + `.select(...)`** return only the fields the DTO needs (spec task 1); `.populate`
  adds `brand: { name }`. The `select` list was tightened in `a53a25f` so `__v` and any future
  internal field never load.
- `total` is the **full** live count (not the page length), so the client can compute pages.

### `getCampaignByIdForCreator(id)` (added alongside the list)

```ts
export async function getCampaignByIdForCreator(id: string): Promise<CampaignDTO> {
  const campaign = await Campaign.findOne({ _id: id, status: 'live' })
    .populate('brand', 'name')
    .lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }
  return toCampaignDTO(campaign);
}
```

- The creator read is **also scoped by `status: 'live'`**, so a creator reading an exhausted (or
  unknown) campaign gets the same plain 404 — no state is revealed.
- The brand path (`getCampaignByIdForBrand`, Phase 4) is unchanged: scoped by `_id` **and**
  `brand`.

## Deep dive — `backend/src/controllers/campaignController.ts`

Two additions this phase:

```ts
export async function getCampaignById(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const id = req.params.id as string;
  if (req.user.role === 'brand') {
    const campaign = await getCampaignByIdForBrand(id, req.user.id);
    res.json({ campaign });
    return;
  }
  const campaign = await getCampaignByIdForCreator(id);
  res.json({ campaign });
}

export async function listLiveCampaignsHandler(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const { page, limit } = req.query as unknown as PaginationQuery;
  const result = await listLiveCampaigns(page, limit);
  res.json(result);
}
```

- **One handler, two roles** on `GET /:id`: the role branch is the only logic here — a brand is
  scoped to its own campaigns, a creator to live campaigns. The `req.user.role` check keeps the
  handler thin (spec §9).
- `req.params.id as string` / `req.query as unknown as PaginationQuery` are safe because the
  route already ran the matching `validate(...)` middleware; the casts just satisfy
  `@types/express`'s looser `Request` types.
- `listLiveCampaignsHandler` responds with the **whole** `{ items, page, limit, total }` object
  the service returns.

## Deep dive — `backend/src/routes/campaigns.ts`

```ts
// Route order matters: `/mine` must be registered before `/:id`, or the id
// matcher would swallow it. Final order: POST /, GET / (creator list), GET /mine,
// GET /:id, GET /:id/submissions.
router.post('/', authenticate, requireRole('brand'), validate(createCampaignSchema, 'body'), asyncHandler(createCampaign));

router.get('/', authenticate, requireRole('creator'), validate(paginationQuerySchema, 'query'), asyncHandler(listLiveCampaignsHandler));

router.get('/mine', authenticate, requireRole('brand'), asyncHandler(listMyCampaigns));

router.get('/:id', authenticate, requireRole('brand', 'creator'), validate(objectIdParamSchema, 'params'), asyncHandler(getCampaignById));

router.get('/:id/submissions', authenticate, requireRole('brand'), validate(objectIdParamSchema, 'params'), asyncHandler(listCampaignSubmissions));
```

- **Same path `/` carries two roles by method**: `POST /` is brand-only, `GET /` is
  creator-only — Express matches on method + path, so they coexist.
- `GET /:id` now allows **both** roles (`requireRole('brand', 'creator')`); the controller
  branches on role. `GET /:id/submissions` stays brand-only.
- **Order is still load-bearing:** `GET /mine` is registered before `GET /:id`, otherwise `mine`
  would be captured as an `:id`.

## Deep dive — `backend/src/services/submissionService.ts`

New this phase.

### `create(creatorId, input)`

```ts
export async function create(creatorId: string, input: CreateSubmissionInput): Promise<SubmissionDocument> {
  const campaign = await Campaign.findById(input.campaignId).lean();
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (campaign.status !== 'live') {
    throw new ConflictError('Campaign is no longer live');
  }

  const validation = validateAndNormalizePostUrl(input.postUrl, campaign.platform);
  if (!validation.ok) {
    throw new ValidationError(validation.reason);
  }

  const now = new Date();
  const postUrl = input.postUrl.trim();

  try {
    const submission = await Submission.create({
      campaign: campaign._id,
      creator: creatorId,
      postUrl,
      normalizedUrl: validation.normalized,
      views: 0,
      entitledAmount: 0,
      paidAmount: 0,
      lastViewsUpdatedAt: now,
    });
    await submission.populate('campaign', 'name platform');
    return submission;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ConflictError('This post has already been submitted');
    }
    throw err;
  }
}
```

- **Unknown campaign → 404**; **found but not live → 409** "Campaign is no longer live"
  (spec task 2). The distinction matters: one is "bad id", the other is "too late".
- **Platform check reuses the domain** `validateAndNormalizePostUrl(postUrl, campaign.platform)`
  (D11) — a YouTube link on an Instagram campaign fails here with the domain's human-readable
  reason, surfaced as a 400.
- The raw `postUrl` is stored for display; the **`normalizedUrl`** (canonical) drives the unique
  index so the same post can't be submitted twice.
- A duplicate is caught by **catching error 11000**, never by a pre-check — a pre-check would
  race under concurrent submits (spec task 2). The test fires two identical POSTs in parallel and
  asserts exactly one 201 and one 409.
- New submissions start at `views: 0`, amounts `0`, and `lastViewsUpdatedAt: now`.
- `populate('campaign', 'name platform')` lets the response embed the campaign summary in one
  round trip.

### `listMySubmissions(creatorId)`

```ts
export async function listMySubmissions(creatorId: string): Promise<SubmissionLike[]> {
  const submissions = await Submission.find({ creator: creatorId })
    .sort({ createdAt: -1 })
    .populate('campaign', 'name platform')
    .lean();
  return submissions as unknown as SubmissionLike[];
}
```

- Scoped by `creator` (spec task 3), newest first, campaign summary populated.
- Returns the loose `SubmissionLike` type so the controller can map straight through
  `toSubmissionDTO` (the `as unknown as SubmissionLike[]` bridged the `.lean()` return type;
  the `a53a25f` cleanup formalized the return type instead of casting at the call site).

## Deep dive — `backend/src/services/submissionDto.ts`

Phase 4 created `toSubmissionDTO`; Phase 5 `ad952ac` taught it to embed a campaign summary:

```ts
/** Campaign summary carried on the submission (spec §5.3). */
export interface SubmissionCampaignDTO {
  id: string;
  name: string;
  platform: CampaignPlatform;
}

export interface ToSubmissionDTOOptions {
  /** Campaign summary to embed; the caller supplies it when it has the campaign. */
  campaign?: SubmissionCampaignDTO;
}
```

and inside `toSubmissionDTO`:

```ts
if (opts?.campaign !== undefined) {
  dto.campaign = opts.campaign;
} else if (doc.campaign !== null && typeof doc.campaign === 'object') {
  const c = doc.campaign as { _id?: unknown; id?: unknown; name?: unknown; platform?: unknown };
  const cid = resolveId(c._id) ?? resolveId(c.id);
  if (cid !== undefined && typeof c.name === 'string' && typeof c.platform === 'string') {
    dto.campaign = { id: cid, name: c.name, platform: c.platform as CampaignPlatform };
  }
}
```

- **Two ways a campaign summary appears:** either the caller passes `opts.campaign` (brand
  submission list, Phase 4 — reuses the campaign it already loaded), or the document's
  `campaign` was populated (creator "my submissions"). A bare ObjectId in that position yields
  **no** `campaign` field, only `campaignId`.
- `campaignId` is always derived from the same `campaign` value, so a populated or unpopulated
  reference both produce the id string.
- `capped`, `creator`, and the field whitelist are unchanged from Phase 4.

## Deep dive — `backend/src/controllers/submissionController.ts`

```ts
export async function createSubmission(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const submission = await createSubmissionRecord(req.user.id, req.body as CreateSubmissionInput);
  res.status(201).json({ submission: toSubmissionDTO(submission) });
}

export async function listMySubmissions(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const items = await listMySubmissionsRecord(req.user.id);
  res.json({ items: items.map((item) => toSubmissionDTO(item)) });
}
```

- **Thin handlers (spec §9):** the chain already ran `authenticate` + `requireRole('creator')` +
  `validate`, so each handler guards `req.user`, delegates, and responds.
- The create handler maps the saved document through `toSubmissionDTO` (so `_id`/`__v`/
  `normalizedUrl` never leak) and returns 201.

## Deep dive — `backend/src/routes/submissions.ts`

```ts
const router = Router();

router.get('/mine', authenticate, requireRole('creator'), asyncHandler(listMySubmissions));

router.post(
  '/',
  authenticate,
  requireRole('creator'),
  validate(createSubmissionSchema, 'body'),
  asyncHandler(createSubmission),
);

export { router as submissionsRouter };
```

- **`/mine` is registered before `/`** — here `/` is a collection POST, but the convention (and
  the future `/:id/views` route in Phase 6) keeps the literal routes first.
- Every route is creator-only; the POST validates the body.
- Mounted in `app.ts`: `app.use('/api/submissions', submissionsRouter)`.

## Deep dive — `backend/src/services/earningsService.ts`

```ts
export async function getCreatorEarnings(creatorId: string): Promise<CreatorEarnings> {
  // Aggregation does NOT cast strings to ObjectId: without the explicit
  // conversion the $match would silently match nothing.
  const rows = await Submission.aggregate<EarningsRow>([
    { $match: { creator: new Types.ObjectId(creatorId) } },
    {
      $group: {
        _id: '$campaign',
        paidAmount: { $sum: '$paidAmount' },
        submissionCount: { $sum: 1 },
      },
    },
  ]);

  if (rows.length === 0) {
    return { totalEarnings: 0, submissionCount: 0, byCampaign: [] };
  }

  const campaigns = await Campaign.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name')
    .lean();
  const nameByCampaign = new Map(campaigns.map((campaign) => [campaign._id.toString(), campaign.name]));

  const byCampaign: EarningsByCampaign[] = rows.map((row) => ({
    campaignId: row._id.toString(),
    campaignName: nameByCampaign.get(row._id.toString()) ?? '',
    paidAmount: row.paidAmount,
    submissionCount: row.submissionCount,
  }));

  return {
    totalEarnings: byCampaign.reduce((sum, row) => sum + row.paidAmount, 0),
    submissionCount: byCampaign.reduce((sum, row) => sum + row.submissionCount, 0),
    byCampaign,
  };
}
```

- **One `$group` on `creator`** produces the per-campaign sums (spec task 4); campaign names come
  from a second query and are merged via a `Map` — no N+1.
- **`new Types.ObjectId(creatorId)` is load-bearing:** an aggregation does not cast strings, so a
  bare `creatorId` string in `$match` would silently match nothing and always report zeros.
- **Empty result → zeros**, not an error (spec task 4 / test "returns all zeros").
- `submissionCount` and `totalEarnings` are the sums of the rows, so they stay consistent with
  the breakdown.

## Deep dive — `backend/src/controllers/creatorController.ts`

```ts
export async function getMyEarnings(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthenticatedError('Authentication required');
  }
  const earnings = await getCreatorEarnings(req.user.id);
  res.json({ earnings });
}
```

- Thin handler: the chain ran `authenticate` + `requireRole('creator')`, so `req.user.id` is the
  creator. Responds with `{ earnings }`.

## Deep dive — `backend/src/routes/creators.ts`

```ts
const router = Router();

router.get('/me/earnings', authenticate, requireRole('creator'), asyncHandler(getMyEarnings));

export { router as creatorsRouter };
```

- Creator-only. Mounted in `app.ts`: `app.use('/api/creators', creatorsRouter)`.
- The path is `/me/earnings` (not `/:id`), so it needs no ObjectId param validation.

## Deep dive — `backend/src/app.ts`

```ts
import { submissionsRouter } from './routes/submissions';
import { creatorsRouter } from './routes/creators';
// ...
app.use('/api/campaigns', campaignsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/creators', creatorsRouter);
```

- Two new mounts (`/api/submissions`, `/api/creators`); the campaign router was already mounted
  and just gained routes.

---

## The tests

Setup mirrors the other suites: `setupTestDb()` + `Model.init()` (to build the unique indexes),
`clearTestDb()` between tests, `teardownTestDb()` at the end. Phase 5 added two unit suites and
seven integration suites, organised so the four "Group N" suites mirror the spec's task order.

**Unit**

- `tests/unit/pagination.test.ts` (7): defaults `{ page: 1, limit: 20 }`; coerces string page/
  limit to numbers; rejects `limit > 100`, `limit < 1`, `page < 1`, non-integer `page`, and
  decimal `page`.
- `tests/unit/submissionSchema.test.ts` (6): valid input passes; missing/bad `campaignId`;
  missing/empty `postUrl`; `postUrl` over 2048 chars.

**Integration**

- `tests/integration/creatorCampaigns.test.ts` — **Group 1, browse** (6): 401 without a token;
  403 for a brand token; lists only live campaigns (a directly inserted exhausted one is
  hidden); `page`/`limit`/`total` across more than one page; a creator can read a live campaign
  by id; 404 when a creator reads an exhausted campaign by id.
- `tests/integration/submissions.test.ts` — **Group 2, submit** (10): valid Instagram link → 201
  with zero views/amounts; wrong-platform URL → 400; same link twice → 409; the same link with
  `?utm=…` → 409 (normalization); `youtu.be` after the same `watch?v=` → 409 (normalization);
  unknown campaign → 404; malformed `campaignId` → 400; exhausted campaign → 409; brand
  submitting → 403; **two parallel identical POSTs → exactly one 201 and one 409**.
- `tests/integration/submissions-mine.test.ts` — **Group 3, my submissions** (1): each creator
  sees only their own, with `campaign.name` and `campaign.platform` embedded.
- `tests/integration/earnings.test.ts` — **Group 4, earnings** (3): all zeros for a creator with
  no submissions; sums `paidAmount` across campaigns with the `byCampaign` breakdown; does not
  include another creator's earnings.
- `tests/integration/campaigns-list.test.ts` (4) and `tests/integration/submissions-create.test.ts`
  (8): earlier stand-alone suites for the same two behaviours (list pagination; create + 409/400/
  404 + 403). They predate the four-group suites and still pass.
- `tests/integration/campaigns-get-by-id.test.ts` (5): role matrix on `GET /:id` — creator on a
  live campaign → 200, creator on exhausted → 404, brand owner → 200, other brand → 404,
  malformed id → 400.

> Note: `campaigns-list.test.ts` and `submissions-create.test.ts` **duplicate** the Group 1/Group 2
> coverage. They were kept (both green) rather than deleted; consolidating them into the group
> suites is an optional tidy-up.

Result: **236 tests passing** across 20 suites; build clean.

---

## How to change things in Phase 5

| You want to… | Do this |
|---|---|
| Change pagination defaults or the cap | `src/validators/common.ts` → `paginationQuerySchema` (`page`/`limit`). |
| Change the submit body rules (e.g. max URL length) | `src/validators/submission.ts` → `createSubmissionSchema`. |
| Change which campaigns a creator sees | `src/services/campaignService.ts` → `listLive` (`status: 'live'`, sort, select, populate). |
| Change the creator's single-campaign visibility | `src/services/campaignService.ts` → `getCampaignByIdForCreator`. |
| Change the "not live" submit behaviour (409 → something else) | `src/services/submissionService.ts` → `create`. |
| Change how a duplicate URL is detected | `src/services/submissionService.ts` → the `catch` on 11000 (keep relying on the unique index, not a pre-check). |
| Change the submission response shape | `src/services/submissionDto.ts` → `toSubmissionDTO` (and the tests). |
| Change the earnings math or breakdown | `src/services/earningsService.ts` → `getCreatorEarnings` (keep the `ObjectId` cast in `$match`). |
| Add a new creator endpoint | Add a service function, a thin controller, and a route in `src/routes/submissions.ts` or `src/routes/creators.ts`. |
| Change the campaign detail role rules | `src/routes/campaigns.ts` (`requireRole('brand', 'creator')`) + `src/controllers/campaignController.ts` → `getCampaignById`. |

> Rule of thumb: routes/middleware never touch the domain math; services call the domain and the
> database; controllers stay thin. Keep that layering and changes stay local.

---

## How the pieces connect (request flow)

```
GET /api/campaigns
  → authenticate                       (401 on missing/bad/expired token)
  → requireRole('creator')             (403 for a brand)
  → validate(paginationQuerySchema)    (400 on bad page/limit; coerced defaults)
  → listLive                           (live only, newest first, page + total in parallel)
  → 200 { items, page, limit, total }

GET /api/campaigns/:id
  → authenticate → requireRole('brand', 'creator')
  → validate(objectIdParamSchema)      (400 on a malformed id)
  → getCampaignById                    (brand: own only; creator: live only; else 404)
  → 200 { campaign }

POST /api/submissions
  → authenticate → requireRole('creator')
  → validate(createSubmissionSchema)   (400 + details; body replaced with parsed value)
  → createSubmission                   (404 unknown / 409 not live; URL validated for platform;
                                        unique normalizedUrl via index → 409 on duplicate)
  → 201 { submission }

GET /api/submissions/mine
  → authenticate → requireRole('creator')
  → listMySubmissions                  (own submissions newest first, campaign name/platform)
  → 200 { items }

GET /api/creators/me/earnings
  → authenticate → requireRole('creator')
  → getCreatorEarnings                 (one $group by campaign; names merged via a Map;
                                        zeros when there is nothing)
  → 200 { earnings }
```

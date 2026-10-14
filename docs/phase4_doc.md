# Phase 4 — Brand: Campaigns

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 5.1–5.3, 7 Phase 4); this doc explains the *code*.

## What this phase delivers

A brand can now create campaigns and read them back with live budget figures:

- `POST /api/campaigns` → `201 { campaign }` (brand only)
- `GET /api/campaigns/mine` → `200 { items }` (brand only; own campaigns, newest first)
- `GET /api/campaigns/:id` → `200 { campaign }` (owner brand only; otherwise 404)
- `GET /api/campaigns/:id/submissions` → `200 { items }` (owner brand only; otherwise 404)
- `createCampaignSchema` — zod body validation plus the D8/D9 ladder rules via
  `validateMilestones`, with per-field `details`.
- `toCampaignDTO()` — the shared campaign shape that derives `remaining = budget − spent`.
- `toSubmissionDTO()` — the shared submission shape that derives `capped`.
- 14 integration tests in four groups (create, validation, auth/roles, ownership).

**Exit criteria met:** a brand can create a campaign and see budget spent vs. remaining via the
API.

**Commits:** `f62823e` (campaign DTO), `84dcc6f` (validation schema), `187899a` (create
endpoint), `a1a0207` (brand listing `/mine`), `57098fc` (read endpoints `/:id` and
`/:id/submissions`), `257fd8e` + `17e6d2d`/`090abe5`/`f424e76`/`934a08a` (integration tests,
final four-group structure).

---

## Deep dive — `backend/src/validators/campaign.ts`

```ts
const milestoneSchema = z.object({
  views: z.number().int().positive('views must be a positive integer'),
  payout: z.number().int().positive('payout must be a positive integer'),
});

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be at most 120 characters'),
    platform: z.enum(['instagram', 'youtube']),
    budget: z.number().int().positive('budget must be a positive integer'),
    milestones: z
      .array(milestoneSchema)
      .min(MIN_MILESTONES, `At least ${MIN_MILESTONES} milestone is required`)
      .max(MAX_MILESTONES, `At most ${MAX_MILESTONES} milestones are allowed`),
  })
  .superRefine((data, ctx) => {
    if (data === null || typeof data !== 'object') return;
    if (!Array.isArray(data.milestones) || typeof data.budget !== 'number') return;
    const result = validateMilestones(data.milestones, data.budget);
    if (result.ok) return;
    for (const error of result.errors) {
      ctx.addIssue({ code: 'custom', path: error.path.split('.'), message: error.message });
    }
  });
```

- **Structural checks live in the zod fields**; the cross-field ladder rules (D8 strictly
  increasing views *and* payouts, D9 budget ≥ smallest payout) run through the pure
  `validateMilestones` in `superRefine`.
- Every problem the domain reports is re-emitted as a zod issue **at its own path** (e.g.
  `milestones.1.views`, `budget`), so the API's `details` array points the client at the exact
  field.
- **The ladder is NOT sorted here.** The service sorts before storing (D8), so an unsorted but
  otherwise valid ladder passes validation untouched.
- `z.number()` rejects strings and `.int()` rejects floats — money never arrives as `"100"` or
  `100.5`.

## Deep dive — `backend/src/validators/common.ts`

```ts
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z.string().trim().regex(OBJECT_ID_PATTERN, 'Invalid ObjectId');
export const objectIdParamSchema = z.object({ id: objectIdSchema });
```

- Shared param schema for every `/:id` route. A malformed id becomes a 400 `VALIDATION_ERROR`
  with `details: [{ path: 'id', message: 'Invalid ObjectId' }]` **before** any database call —
  so a bad id never produces a Mongoose `CastError`.

## Deep dive — `backend/src/services/campaignDto.ts`

```ts
export function toCampaignDTO(doc: CampaignLike, opts?: ToCampaignDTOOptions): CampaignDTO {
  const id = resolveId(doc._id) ?? resolveId(doc.id);
  if (id === undefined) throw new Error('toCampaignDTO: campaign is missing an id');

  const dto: CampaignDTO = {
    id,
    name: doc.name,
    platform: doc.platform,
    budget: doc.budget,
    spent: doc.spent,
    remaining: doc.budget - doc.spent,   // derived, never stored
    status: doc.status,
    milestones: doc.milestones.map((m) => ({ views: m.views, payout: m.payout })),
    createdAt: doc.createdAt,
  };

  const brand = toBrandDTO(doc.brand);
  if (brand !== undefined) dto.brand = brand;
  if (opts?.submissionCount !== undefined) dto.submissionCount = opts.submissionCount;
  return dto;
}
```

- **`remaining` is computed here and nowhere else** (spec Phase 4 task 5) — the model has a
  `remaining` virtual too, but the API always goes through this DTO.
- Only the listed fields are copied, so `_id`, `__v` and any other internal field never leak
  (D18).
- The input type is deliberately loose (`CampaignLike`) so it accepts both hydrated Mongoose
  documents and `.lean()` objects.
- `brand` is included **only when populated** (a populated brand is an object with a string
  `name`; a bare ObjectId is omitted). `submissionCount` is included only when the caller
  supplies it.

## Deep dive — `backend/src/services/submissionDto.ts`

```ts
export function toSubmissionDTO(doc: SubmissionLike, opts?: ToSubmissionDTOOptions): SubmissionDTO {
  const id = resolveId(doc._id) ?? resolveId(doc.id);
  if (id === undefined) throw new Error('toSubmissionDTO: submission is missing an id');

  // `campaignId` is resolved just above: a bare ObjectId or a populated campaign both
  // yield the id string the API exposes.
  const dto: SubmissionDTO = {
    id,
    campaignId,
    postUrl: doc.postUrl,
    views: doc.views,
    entitledAmount: doc.entitledAmount,
    paidAmount: doc.paidAmount,
    capped: doc.paidAmount < doc.entitledAmount,   // derived (spec §5.3)
    flagged: doc.flagged,
    flagReason: doc.flagReason ?? null,
    createdAt: doc.createdAt,
  };

  if (opts?.campaign !== undefined) dto.campaign = opts.campaign;
  const creator = toCreatorDTO(doc.creator);
  if (creator !== undefined) dto.creator = creator;
  return dto;
}
```

- The public submission shape (spec §5.3) plus `creator: { id, name }` when populated.
- **`capped` is always derived** (`paidAmount < entitledAmount`), never read from the input.
- `normalizedUrl` and other internals are never copied.
- The brand submissions endpoint passes the campaign summary in via `opts.campaign`, so each
  item carries `campaign: { id, name, platform }` without a second query.

## Deep dive — `backend/src/services/campaignService.ts`

### `create(brandId, input)`

```ts
const campaign = new Campaign({
  brand: brandId,
  name: input.name,
  platform: input.platform,
  budget: input.budget,
  spent: 0,                       // D10
  status: 'live',                 // D10
  milestones: normalizeMilestones(input.milestones),   // sorted ascending (D8)
});
await campaign.save();
await campaign.populate('brand', 'name');
return campaign;
```

- Normalizes (sorts) the ladder before storing, so the database always holds an ascending
  ladder regardless of the order the client sent.
- `spent` starts at 0 and the campaign is `live` immediately.
- Populates `brand` so the create response can render `brand: { id, name }`.

### `listMyCampaigns(brandId)`

```ts
const campaigns = await Campaign.find({ brand: brandId }).sort({ createdAt: -1 }).lean();

const ids = campaigns.map((c) => c._id);
const rows = await Submission.aggregate<SubmissionCountRow>([
  { $match: { campaign: { $in: ids } } },
  { $group: { _id: '$campaign', count: { $sum: 1 } } },
]);

const countByCampaign = new Map<string, number>();
for (const row of rows) countByCampaign.set(row._id.toString(), row.count);

return campaigns.map((c) =>
  toCampaignDTO(c, { submissionCount: countByCampaign.get(c._id.toString()) ?? 0 }),
);
```

- **One aggregation for all counts**, merged via a `Map` — no N+1 queries (spec Phase 4 task 3).
- Campaigns with no submissions get `submissionCount: 0`.
- Newest first (`createdAt: -1`).

### `getCampaignById(id, brandId)` and `listCampaignSubmissions(id, brandId)`

```ts
const campaign = await Campaign.findOne({ _id: id, brand: brandId }).lean();
if (!campaign) throw new NotFoundError('Campaign not found');
```

- The query is scoped by **both** `_id` and `brand`, so another brand's campaign produces the
  same 404 as an unknown id — ownership is never revealed (spec Phase 4 task 4).
- `listCampaignSubmissions` then reads the submissions in one query:

```ts
const submissions = await Submission.find({ campaign: id })
  .populate('creator', 'name')
  .sort({ createdAt: -1 })
  .lean();
```

## Deep dive — `backend/src/controllers/campaignController.ts`

```ts
export async function createCampaign(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError('Authentication required');
  const campaign = await createCampaignRecord(req.user.id, req.body as CreateCampaignInput);
  res.status(201).json({ campaign: toCampaignDTO(campaign) });
}

export async function listMyCampaigns(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError('Authentication required');
  const items = await listMyCampaignsForBrand(req.user.id);
  res.json({ items });
}

export async function getCampaignById(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError('Authentication required');
  const campaign = await getCampaignByIdForBrand(req.params.id as string, req.user.id);
  res.json({ campaign });
}

export async function listCampaignSubmissions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthenticatedError('Authentication required');
  const items = await listCampaignSubmissionsForBrand(req.params.id as string, req.user.id);
  res.json({ items });
}
```

- **Thin handlers (spec §9):** the route chain already ran `authenticate` + `requireRole('brand')`
  + `validate`, so each handler only guards `req.user`, delegates to the service, and responds.
  No business logic lives here.
- The `req.params.id as string` cast exists because `@types/express` types params as
  `string | string[] | undefined`; the `validate(objectIdParamSchema, 'params')` middleware
  guarantees a string at runtime.

## Deep dive — `backend/src/routes/campaigns.ts`

```ts
// Route order matters: `/mine` must be registered before `/:id`, or the id
// matcher would swallow it. Final order: POST /, GET /mine, GET /:id,
// GET /:id/submissions. All campaign routes require the brand role.
router.post('/', authenticate, requireRole('brand'), validate(createCampaignSchema, 'body'), asyncHandler(createCampaign));
router.get('/mine', authenticate, requireRole('brand'), asyncHandler(listMyCampaigns));
router.get('/:id', authenticate, requireRole('brand'), validate(objectIdParamSchema, 'params'), asyncHandler(getCampaignById));
router.get('/:id/submissions', authenticate, requireRole('brand'), validate(objectIdParamSchema, 'params'), asyncHandler(listCampaignSubmissions));
```

- **Order is load-bearing:** `GET /mine` is registered before `GET /:id`, otherwise Express would
  match `mine` as an `:id`.
- Every route requires the brand role; `:id` routes validate the param first.
- Mounted in `app.ts`: `app.use('/api/campaigns', campaignsRouter)`.

---

## The tests — `tests/integration/campaigns.test.ts`

Setup mirrors the other integration suites: `setupTestDb()` + `User.init()` + `Submission.init()`
(builds the unique indexes), `clearTestDb()` between tests, `teardownTestDb()` at the end. The
suite is organised into four groups (14 tests):

- **Group 1 — Create:** a valid campaign returns 201 with milestones sorted ascending (the test
  sends them unsorted), `spent: 0`, `remaining = budget`, `status: 'live'`, plus the populated
  `brand` summary.
- **Group 2 — Validation** (each → 400 with `details`): duplicate view thresholds
  (`milestones.1.views`), non-increasing payouts (`milestones.1.payout`), budget below the
  smallest payout (`budget`), empty ladder (`milestones`), more than 20 milestones
  (`milestones`), float budget (`budget`).
- **Group 3 — Auth and roles:** a creator gets 403 `FORBIDDEN`; no token gets 401
  `UNAUTHENTICATED`; with two brands, each brand's `/mine` shows only its own campaigns.
- **Group 4 — Ownership:** another brand's `GET /:id` and `GET /:id/submissions` return 404
  `NOT_FOUND`; a malformed id returns 400 `VALIDATION_ERROR`; the owner sees a manually inserted
  submission with the right DTO shape (`creator { id, name }`, campaign summary, `capped: true`
  when `paidAmount < entitledAmount`).

---

## How to change things in Phase 4

| You want to… | Do this |
|---|---|
| Change campaign field rules (name length, platform list) | `src/validators/campaign.ts` → `createCampaignSchema`. |
| Change ladder rules (count, ordering, minimum budget) | `src/domain/milestones.ts` → `validateMilestones` (shared with the domain tests). |
| Change the campaign response shape | `src/services/campaignDto.ts` → `toCampaignDTO` (and the tests). |
| Change the submission response shape | `src/services/submissionDto.ts` → `toSubmissionDTO`. |
| Change how `remaining` is computed | `src/services/campaignDto.ts` (keep it derived, never stored). |
| Change the `/mine` ordering or counts | `src/services/campaignService.ts` → `listMyCampaigns`. |
| Change ownership behaviour (e.g. 403 instead of 404) | `src/services/campaignService.ts` → `getCampaignById` / `listCampaignSubmissions`. |
| Add a new brand endpoint | Add a service function, a thin controller, and a route in `src/routes/campaigns.ts` (mind the `/mine`-before-`/:id` order). |
| Change the id param validation | `src/validators/common.ts` → `objectIdParamSchema`. |

> Rule of thumb: routes/middleware never touch the domain math; services call the domain and the
> database; controllers stay thin. Keep that layering and changes stay local.

---

## How the pieces connect (request flow)

```
POST /api/campaigns
  → authenticate                  (401 on missing/bad/expired token)
  → requireRole('brand')          (403 for a creator)
  → validate(createCampaignSchema) (400 + per-field details; body replaced with parsed value)
  → createCampaign                (service: sort ladder, spent 0, status live, populate brand)
  → 201 { campaign }

GET /api/campaigns/mine
  → authenticate → requireRole('brand')
  → listMyCampaigns               (own campaigns newest first + one aggregation for counts)
  → 200 { items }

GET /api/campaigns/:id
  → authenticate → requireRole('brand')
  → validate(objectIdParamSchema) (400 on a malformed id)
  → getCampaignById               (findOne scoped by _id AND brand; else 404)
  → 200 { campaign }

GET /api/campaigns/:id/submissions
  → authenticate → requireRole('brand')
  → validate(objectIdParamSchema)
  → listCampaignSubmissions       (ownership check, then submissions with creator populated)
  → 200 { items }
```

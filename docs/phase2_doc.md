# Phase 2 — Database, Models, App Skeleton

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 4, 5.1, 7 Phase 2, 8.6); this doc explains the *code*.

## What this phase delivers

The app becomes a real (if small) HTTP server:

- `config/db.ts` — MongoDB connection with a fail-fast timeout.
- `config/logger.ts` — the one place that writes to the console (spec §9: no stray
  `console.log`).
- Three Mongoose models (`User`, `Campaign`, `Submission`) with all indexes, validators,
  and the D18 `toJSON` transform.
- An error hierarchy (`AppError` + subclasses) and the middleware pipeline
  (`asyncHandler`, `validate`, `notFound`, `errorHandler`).
- `app.ts` (builds the Express app, no listen) and `server.ts` (connects DB, listens,
  graceful shutdown).
- `GET /health` — the first live endpoint.
- Integration tests against an **in-memory MongoDB replica set** (spec §8.6).

**Exit criteria met:** server boots against a Mongo; `GET /health` returns 200; indexes are
created (asserted in tests).

**Commits:** `176fc27` (models + indexes), `406122a` (app, errors, middleware),
`590d923` (integration tests).

---

## Deep dive — `backend/src/config/logger.ts`

```ts
type LogLevel = 'info' | 'warn' | 'error';

function emit(level, message, meta?) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  // sink(line) or sink(line, meta)
}

export const logger = { info, warn, error };
export type Logger = typeof logger;
```

- Every log line is `ISO-timestamp [LEVEL] message`, with an optional `meta` second
  argument (used by `errorHandler` to attach the error object).
- Errors go to `console.error`, warnings to `console.warn`, everything else to
  `console.log`.
- If you ever swap in a real logging library (pino, winston), you only change this file —
  call sites stay the same.

## Deep dive — `backend/src/config/db.ts`

```ts
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

export async function connectDb(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
  logger.info(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name} (${mongoose.connection.readyState})`);
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}
```

- `serverSelectionTimeoutMS: 10_000` — if Mongo is unreachable, the connection fails after
  10 seconds with a clear error instead of hanging forever (verified by the smoke test:
  the server logs `Failed to start server` and exits 1).
- The **URI is never logged** — only host and database name (credentials could be embedded
  in the URI).
- `disconnectDb` is a no-op when already disconnected (used by tests and graceful shutdown).

## Deep dive — `backend/src/models/toJSON.ts`

```ts
export function toJSONTransform(_doc: unknown, ret: Record<string, unknown>): void {
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
  }
  delete ret._id;
  delete ret.__v;
  delete ret.passwordHash;
}
```

The shared D18 transform, wired into every model's schema options
(`toJSON: { transform: toJSONTransform }`). Whenever a document is serialized
(`res.json(...)`, `doc.toJSON()`):

- `id` is the string form of `_id`;
- `_id`, `__v` (Mongoose's version key) and `passwordHash` are removed.

This is the **first** line of defense against leaking password hashes; `select: false` on
the field is the second.

## Deep dive — `backend/src/models/User.ts`

```ts
export type UserRole = 'brand' | 'creator';

export interface IUser {
  name: string; email: string; passwordHash: string;
  role: UserRole; createdAt: Date; updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, required: true, enum: ['brand', 'creator'] },
}, { timestamps: true, toJSON: { transform: toJSONTransform } });

export const User: Model<IUser> = model<IUser>('User', userSchema);
```

- `email` is `lowercase: true` + `trim: true` (normalized at the model level, so even a
  direct `User.create` gets a clean email) and `unique: true` (creates the unique index —
  the duplicate-email 409 in Phase 3 relies on it).
- `passwordHash` is `select: false` — it is **not returned by queries** unless you opt back
  in with `.select('+passwordHash')` (the login flow does exactly that).
- `role` is restricted to `brand | creator` by the enum.
- `timestamps: true` adds `createdAt`/`updatedAt` automatically.

## Deep dive — `backend/src/models/Campaign.ts`

```ts
export type CampaignPlatform = 'instagram' | 'youtube';
export type CampaignStatus = 'live' | 'exhausted';
export interface IMilestone { views: number; payout: number; }
export interface ICampaign {
  brand: Types.ObjectId; name: string; platform: CampaignPlatform;
  budget: number; spent: number; milestones: IMilestone[];
  status: CampaignStatus; createdAt: Date; updatedAt: Date;
}
```

- **`milestoneSchema`** — a subdocument schema with `{ _id: false }` (milestones don't need
  their own ids). `views`/`payout` are `min: 1` and validated with `Number.isInteger`.
- **`brand`** — `ref: 'User'`, `index: true` (the `brand` index from spec §4.2).
- **`budget`** — `min: 1`, integer-validated.
- **`spent`** — `default: 0`, `min: 0`, integer-validated, plus a **cross-field validator**:
  `value <= this.budget` ("spent cannot exceed budget"). Note the validator uses a regular
  `function` (not an arrow) so `this` is the document.
- **`status`** — enum `live | exhausted`, default `live`.
- **Compound index** (spec §4.2): `campaignSchema.index({ status: 1, createdAt: -1 })` —
  powers "list live campaigns newest first" (Phase 5).
- **Virtual** `remaining` — `budget - spent`. Virtuals are computed, not stored; they appear
  in `toJSON()` output but are read via `doc.get('remaining')` when you need the value
  without serialization.

## Deep dive — `backend/src/models/Submission.ts`

```ts
export interface ISubmission {
  campaign: Types.ObjectId; creator: Types.ObjectId;
  postUrl: string; normalizedUrl: string;
  views: number; entitledAmount: number; paidAmount: number;
  lastViewsUpdatedAt: Date;
  flagged: boolean; flagReason?: string | null; flaggedAt?: Date | null;
  createdAt: Date; updatedAt: Date;
}
```

- `campaign` and `creator` are indexed refs.
- **`normalizedUrl` is `unique: true`** — the D11 guarantee that the same post cannot be
  submitted twice, in any campaign. The Phase 5 submit flow relies on catching the 11000
  duplicate-key error rather than a pre-check.
- `views`, `entitledAmount`, `paidAmount` — `default: 0`, `min: 0`, integer-validated.
- `lastViewsUpdatedAt` — `default: Date.now` (used by spike detection later).
- `flagged`/`flagReason`/`flaggedAt` — reserved for Phase 9 spike flags.
- **Virtual** `capped` — `paidAmount < entitledAmount` (spec §5.3).

## Deep dive — `backend/src/errors/AppError.ts` (+ `index.ts`)

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL_ERROR';

export interface ErrorDetail { path: string; message: string; }

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  constructor(statusCode, code, message, details?) { ... }
}
```

Subclasses (all in the same file): `ValidationError` (400), `UnauthenticatedError` (401),
`ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409),
`RateLimitedError` (429).

- `Object.setPrototypeOf(this, new.target.prototype)` — fixes `instanceof` after
  transpilation to ES5-style classes.
- `Error.captureStackTrace` — cleaner stack traces.
- `errors/index.ts` is just `export * from './AppError'` — a barrel so imports read
  `from '../errors'`.

Services throw these; the single `errorHandler` turns them into the §5.1 envelope.

## Deep dive — `backend/src/middleware/asyncHandler.ts`

```ts
type AsyncRequestHandler = (req, res, next) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => { fn(req, res, next).catch(next); };
}
```

Express 4 does **not** catch rejected promises from async handlers — an unhandled rejection
would crash the process. This wrapper forwards rejections to the error pipeline. Every
async route handler is wrapped with it.

## Deep dive — `backend/src/middleware/validate.ts`

```ts
export type ValidateSource = 'body' | 'params' | 'query';

export function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function validate<T>(schema: ZodType<T>, source: ValidateSource = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new ValidationError('Request validation failed', zodDetails(result.error)));
      return;
    }
    (req as unknown as Record<ValidateSource, unknown>)[source] = result.data;
    next();
  };
}
```

- Validates one request part against a zod schema.
- On failure → `ValidationError` (400) with per-field `details` (the §5.1 shape).
- On success it **replaces** the request part with the parsed value — so zod transforms
  (trim, lowercase, coercion) reach the handler. That is why `req.body` in handlers is
  already clean.

## Deep dive — `backend/src/middleware/notFound.ts`

```ts
export const notFound: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};
```

Terminal middleware mounted **after** all routes: any unmatched path becomes a 404 through
the error handler.

## Deep dive — `backend/src/middleware/errorHandler.ts`

The single error handler. `toErrorResponse(err)` maps, in order:

| Error | Status | Code |
|---|---|---|
| `AppError` (and subclasses) | `err.statusCode` | `err.code` (+ `details` if present) |
| `ZodError` | 400 | `VALIDATION_ERROR` (details from issues) |
| Mongoose `ValidationError` | 400 | `VALIDATION_ERROR` (details from `err.errors`) |
| Mongoose `CastError` (bad ObjectId) | 400 | `VALIDATION_ERROR` |
| Mongo duplicate key (`code === 11000`) | 409 | `CONFLICT` (names the duplicated field) |
| JWT errors (`JsonWebTokenError`, `TokenExpiredError`, `NotBeforeError`) | 401 | `UNAUTHENTICATED` |
| anything else | 500 | `INTERNAL_ERROR` — **never leaks internals** |

```ts
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { statusCode, body } = toErrorResponse(err);
  if (statusCode >= 500) {
    logger.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`, err);
  }
  res.status(statusCode).json(body);
};
```

- Only 5xx errors are logged (4xx are expected client mistakes).
- The 500 body is always `{ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }`
  — the real error goes to the log, never to the client (spec §5.1: "never leak stack
  traces in production").

## Deep dive — `backend/src/routes/health.ts`

```ts
const DB_STATES: Record<number, string> = {
  0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting', 99: 'uninitialized',
};

healthRouter.get('/', (_req, res) => {
  const state = DB_STATES[mongoose.connection.readyState] ?? 'unknown';
  res.json({ status: 'ok', db: state });
});
```

- `GET /health` always returns 200 while the process is up, and reports the current
  MongoDB connection state (from `mongoose.connection.readyState`) so operators can see DB
  health at a glance.
- The `?? 'unknown'` fallback covers any future readyState value.

## Deep dive — `backend/src/routes/index.ts`

```ts
export const apiRouter = Router();
apiRouter.use('/auth', authRouter);   // added in Phase 3
```

The aggregation point for every `/api` route. Phase 4+ will mount campaigns, submissions
and creators routers here.

## Deep dive — `backend/src/app.ts`

```ts
export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);                       // behind a reverse proxy, req.ip = client
  app.use(helmet());                               // security headers
  app.use(cors({ origin: corsOrigins(), credentials: true })); // allowlist from env
  app.use(express.json({ limit: '100kb' }));       // JSON bodies, 100kb cap
  app.use('/health', healthRouter);
  app.use('/api', apiRouter);
  app.use(notFound);                               // terminal 404
  app.use(errorHandler);                           // terminal error mapping
  return app;
}
```

- **`createApp` does NOT listen** — tests import it and drive it with supertest;
  `server.ts` is the only place that calls `listen`.
- Middleware order matters: security → parsing → routes → 404 → errors.
- `trust proxy` + `cors` with credentials are needed for the browser frontend later.

## Deep dive — `backend/src/server.ts`

```ts
let server: Server | undefined;

async function start(): Promise<void> {
  await connectDb();                       // fail fast if Mongo is unreachable
  const app = createApp();
  server = app.listen(env.PORT, () => logger.info(`Meme'd API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`));
}

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully`);
  if (server !== undefined) {
    server.close((err) => {
      if (err !== undefined) logger.error('Error while closing HTTP server', err);
      void disconnectDb().finally(() => process.exit(err === undefined ? 0 : 1));
    });
  } else {
    void disconnectDb().finally(() => process.exit(0));
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', reason));

start().catch((err) => { logger.error('Failed to start server', err); process.exit(1); });
```

- Connects the DB **before** listening, so the port is only opened when the app is ready.
- Graceful shutdown: stop accepting connections (`server.close`), then disconnect Mongo,
  then exit (0 on clean close, 1 on error).
- `unhandledRejection` is logged instead of crashing silently.

---

## The tests

### `tests/helpers/mongo.ts`

```ts
let replSet: MongoMemoryReplSet | undefined;

export async function setupTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}
export async function clearTestDb(): Promise<void> { /* deleteMany on every collection */ }
export async function teardownTestDb(): Promise<void> { /* disconnect + stop */ }
```

- One in-memory MongoDB **replica set** per test file (a replica set is required because
  the app uses transactions in Phase 6 — D7).
- `clearTestDb` wipes all collections between tests; `teardownTestDb` stops the server.
- The first run downloads the mongod binary (~330 MB) into `~/.cache/mongodb-binaries`;
  later runs are fast.

### `tests/integration/health.test.ts`

- `GET /health` → 200 with `{ status: 'ok', db: <string> }`.
- Unknown route → 404 with the `NOT_FOUND` envelope.

### `tests/integration/models.test.ts`

- **User**: unique email index (case-insensitively — `A@B.COM` collides with `a@b.com`);
  email lowercased/trimmed on save; unknown role rejected; D18 serialization
  (`id` present, `_id`/`__v`/`passwordHash` absent).
- **Campaign**: non-integer budget rejected; `spent > budget` rejected; defaults
  (`spent: 0`, `status: 'live'`) and `remaining` virtual; the `{status, createdAt}`
  compound index exists (checked via `Campaign.collection.indexes()`).
- **Submission**: globally unique `normalizedUrl` (11000 on duplicate); defaults
  (`views`/amounts 0) and `capped` virtual.

### `tests/integration/errorHandling.test.ts`

Builds a scratch Express app with routes that throw each error type, then asserts the
mapping: `ConflictError` → 409, `ValidationError` with details, async rejection caught,
duplicate-key → 409 (message names the field), `CastError` → 400, unknown error → 500 with
**no internals leaked**, `validate` middleware (400 on bad body, parsed value on good
body), and 404 for unknown routes.

---

## How to change things in Phase 2

| You want to… | Do this |
|---|---|
| Add a field to a model | Edit the interface + schema in `src/models/<Model>.ts`; add a test in `tests/integration/models.test.ts`. |
| Add a new model | Copy the pattern from `Campaign.ts` (interface → schema → `model()`), add the `toJSON` transform, and register indexes. |
| Change the API id shape | `src/models/toJSON.ts` (used by every model). |
| Add a new error type | `src/errors/AppError.ts` (subclass + code) and a mapping in `errorHandler.ts` if it's a foreign error. |
| Add middleware | Create it in `src/middleware/`, wire it into `app.ts` or a router. |
| Add a route | Create a router in `src/routes/`, mount it in `routes/index.ts` (under `/api`). |
| Change the JSON body limit | `app.ts` → `express.json({ limit: '100kb' })`. |
| Change the DB timeout | `src/config/db.ts` → `SERVER_SELECTION_TIMEOUT_MS`. |
| Change CORS origins | `CORS_ORIGIN` env var (see phase0_doc). |
| Change what `/health` reports | `src/routes/health.ts`. |

> Rule of thumb: routes/middleware never touch the domain math; services (Phase 3+) call
> the domain; models only describe data. Keep that layering and changes stay local.
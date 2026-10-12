# Phase 3 — Authentication & Authorization

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`
> (sections 5.1–5.3, 7 Phase 3); this doc explains the *code*.

## What this phase delivers

Users can now sign up, log in, and identify themselves with a JWT:

- `POST /api/auth/signup` → `201 { token, user }`
- `POST /api/auth/login` → `200 { token, user }`
- `GET /api/auth/me` → `200 { user }` (any authenticated user)
- `authenticate` middleware (Bearer JWT → `req.user = { id, role }`)
- `requireRole(...roles)` middleware (403 on role mismatch)
- Rate limiting on signup/login (20 req / 15 min / IP, disabled in tests)
- 18 integration tests covering every flow.

**Exit criteria met:** all auth tests pass; the password hash never appears in any response.

**Commits:** `59b329a` (signup, login, JWT middleware), `5825c18` (integration tests).

---

## Deep dive — `backend/src/schemas/auth.ts`

```ts
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('A valid email is required'));

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name must be at most 80 characters'),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters')
                  .max(72, 'Password must be at most 72 characters'),
  role: z.enum(['brand', 'creator']),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
```

- **Password 8–72**: bcrypt only reads the first 72 bytes, so longer passwords would be
  silently truncated — the schema rejects them up front.
- **The `emailSchema` pipe is important.** `z.email()` validates the *raw* value, so
  `z.email().trim()` would reject `'  A@B.COM '` (spaces fail the format check before the
  trim runs). `z.string().trim().toLowerCase().pipe(z.email(...))` runs the transforms
  **first**, then validates the clean value. This was a real bug caught by a test.
- `validate()` replaces `req.body` with the parsed value, so handlers receive trimmed,
  lowercased data.

## Deep dive — `backend/src/services/authService.ts`

### `AuthUserDTO` / `AuthResult`

```ts
export interface AuthUserDTO { id: string; name: string; email: string; role: UserRole; }
export interface AuthResult { token: string; user: AuthUserDTO; }
```

The public user shape (spec §5.3) — exactly four fields, no `passwordHash`, no timestamps.

### `toUserDTO(user)`

```ts
export function toUserDTO(user: { _id: { toString(): string }; name: string; email: string; role: UserRole }): AuthUserDTO {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
}
```

Accepts a Mongoose document (or anything with `_id.toString()`). The parameter type uses
`_id` instead of `id` because Mongoose types `Document.id` as *optional* — passing a
document where `id: string` is required fails type-checking.

### `signToken(user)`

```ts
export function signToken(user: { id: string; role: UserRole }): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}
```

- Payload is `{ sub: userId, role }` (spec §5.3). `sub` is the standard JWT subject claim.
- The `as jwt.SignOptions['expiresIn']` cast exists because `@types/jsonwebtoken` types
  `expiresIn` as `ms.StringValue`, which is narrower than plain `string`.

### `signup(input)`

```ts
const passwordHash = await hash(input.password, 10);   // bcrypt cost 10 (spec)
const user = new User({ name, email, passwordHash, role });
try {
  await user.save();
} catch (err) {
  if (isDuplicateKeyError(err)) {                      // code === 11000
    throw new ConflictError('An account with this email already exists');
  }
  throw err;
}
const dto = toUserDTO(user);
return { token: signToken(dto), user: dto };
```

- **bcrypt cost 10** — the spec's choice; higher = slower to brute-force, lower = faster.
- Duplicate email is detected by **catching the unique-index error** (11000), never by a
  pre-check — a pre-check would race under concurrency.
- `isDuplicateKeyError` is a local copy of the check in `errorHandler.ts` (small enough to
  duplicate rather than share).

### `login(input)`

```ts
const user = await User.findOne({ email: input.email }).select('+passwordHash');
if (!user) throw new UnauthenticatedError('Invalid email or password');
const valid = await compare(input.password, user.passwordHash);
if (!valid) throw new UnauthenticatedError('Invalid email or password');
const dto = toUserDTO(user);
return { token: signToken(dto), user: dto };
```

- `.select('+passwordHash')` opts back in to the `select: false` field — the only place
  the hash is read.
- **No user enumeration**: unknown email and wrong password produce the *identical* 401
  with the *identical* message. (A test asserts both.)

## Deep dive — `backend/src/types/express.d.ts`

```ts
import type { UserRole } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole };
    }
  }
}
export {};
```

- Augments Express's `Request` type so `req.user` type-checks everywhere.
- The file is under `src/` (tsconfig `rootDir: src`) and matched by `include: ["src/**/*.ts"]`.
- `export {}` makes it a module so `declare global` works.

## Deep dive — `backend/src/middleware/authenticate.ts`

```ts
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthenticatedError('Missing authentication token');
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) throw new UnauthenticatedError('Missing authentication token');

    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;   // { sub?, role? }
    if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
      throw new UnauthenticatedError('Invalid or expired token');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw new UnauthenticatedError('Invalid or expired token');

    req.user = { id: user.id, role: user.role };
    next();
  } catch (err) {
    next(err);   // JWT errors and AppErrors both land in the central error handler
  }
};
```

Step by step:

1. **Header check** — must be `Authorization: Bearer <token>`; anything else → 401.
2. **Verify** — `jwt.verify` throws `JsonWebTokenError`/`TokenExpiredError` for bad or
   expired tokens; the error handler maps those to 401 `UNAUTHENTICATED`.
3. **`sub` sanity** — must be a string that is a valid ObjectId (prevents a forged token
   with a garbage `sub` from producing a Mongoose `CastError` → 400).
4. **Load the user** — the token is only valid if the user still exists (deleted users
   lose access immediately). The role comes from the **database**, not the token, so a
   role change takes effect on the next request.
5. **Attach** `req.user = { id, role }` (spec Phase 3 task 3) and continue.

## Deep dive — `backend/src/middleware/requireRole.ts`

```ts
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) { next(new UnauthenticatedError('Authentication required')); return; }
    if (!roles.includes(req.user.role)) { next(new ForbiddenError()); return; }
    next();
  };
}
```

- Factory: `requireRole('brand')` or `requireRole('creator')` (or both).
- Must run **after** `authenticate`. If `req.user` is missing, the route was reached
  unauthenticated → 401. Wrong role → 403 `FORBIDDEN`.

## Deep dive — `backend/src/routes/auth.ts`

```ts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  limit: 20,                  // 20 requests per window per IP
  standardHeaders: 'draft-7', // RateLimit-* headers on responses
  legacyHeaders: false,
  skip: () => isTest,         // disabled in tests (spec Phase 3 task 5)
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  },
});
```

- The custom `handler` returns the §5.1 envelope instead of express-rate-limit's default
  plain-text message.
- `skip: () => isTest` uses the `isTest` flag from `env.ts` — tests never trip the limiter.

Routes:

```ts
authRouter.post('/signup', authLimiter, validate(signupSchema), asyncHandler(async (req, res) => {
  const result = await signup(req.body);
  res.status(201).json(result);
}));

authRouter.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const result = await login(req.body);
  res.json(result);
}));

authRouter.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw new NotFoundError();
  res.json({ user: toUserDTO(user) });
}));
```

- `/me` re-fetches the user to return the **full** profile (`name`, `email`, `role`), not
  just `{ id, role }` — `authenticate` deliberately attaches only the minimal shape.
  `req.user!` is safe because `authenticate` already verified the user exists (the
  `NotFoundError` branch is defensive).
- `routes/index.ts` mounts it: `apiRouter.use('/auth', authRouter)`.

---

## The tests — `tests/integration/auth.test.ts`

Setup mirrors the other integration suites: `setupTestDb()` + `User.init()` (builds the
unique email index), `clearTestDb()` between tests, `teardownTestDb()` at the end.

- **Signup**: 201 with `token` + `{ id, name, email, role }`; **no `passwordHash`, `_id`
  or `__v` anywhere in the response body** (the exit criterion, asserted via
  `JSON.stringify`); email lowercased + name trimmed; duplicate email → 409 `CONFLICT`;
  weak password → 400 with a `details` entry at path `password`; 73-char password → 400;
  invalid email → 400; unknown role → 400; 81-char name → 400.
- **Login**: valid credentials → 200 with token + user; wrong password → 401
  `UNAUTHENTICATED` "Invalid email or password"; unknown email → the **identical** 401
  (no user enumeration).
- **`/me`**: valid token → 200 full profile; no token → 401; malformed token
  (`Bearer not-a-jwt`) → 401; token signed with a **different secret** → 401.
- **Role guard**: a scratch app (`guardApp`) with `authenticate` + `requireRole('brand')`
  and the real `errorHandler`: brand token → 200; creator token → 403 `FORBIDDEN`;
  no token → 401.

---

## How to change things in Phase 3

| You want to… | Do this |
|---|---|
| Change password rules (min/max length) | `src/schemas/auth.ts` → `signupSchema.password` (keep ≤ 72 for bcrypt). |
| Change token lifetime | `JWT_EXPIRES_IN` env var (e.g. `12h`, `30d`). |
| Change the rate limit | `src/routes/auth.ts` → `authLimiter` (`windowMs`, `limit`). |
| Add a role (e.g. `admin`) | 1) `src/models/User.ts` → `UserRole` + enum; 2) `src/schemas/auth.ts` → `z.enum([...])`; 3) use `requireRole('admin')` on routes. |
| Add an authenticated endpoint | `authenticate` (and `requireRole` if role-restricted) on the route. |
| Change the JWT payload | `src/services/authService.ts` → `signToken` (and `authenticate` reads it). |
| Change the login error message | `src/services/authService.ts` → both `UnauthenticatedError('Invalid email or password')` calls — keep them identical. |
| Change the user shape returned | `src/services/authService.ts` → `toUserDTO` (and the tests). |
| Make `/me` return more fields | `src/routes/auth.ts` → `/me` handler (fetch + DTO). |
| Change bcrypt cost | `src/services/authService.ts` → `hash(input.password, 10)`. |

---

## How the pieces connect (request flow)

```
POST /api/auth/signup
  → authLimiter (429 if over limit)
  → validate(signupSchema)        (400 + details on bad input; body replaced with parsed value)
  → signup(req.body)              (bcrypt hash → save → catch 11000 → ConflictError)
  → 201 { token, user }

GET /api/auth/me
  → authenticate                  (401 on missing/bad/expired token or deleted user)
  → fetch user, toUserDTO
  → 200 { user }

Any future brand/creator route
  → authenticate → requireRole('brand')   (403 on wrong role)
  → handler
```
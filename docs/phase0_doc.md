# Phase 0 — Repository & Tooling Setup

> What was done in this phase, and a line-by-line explanation of every file so you can
> change things yourself. The authoritative rules live in `docs/MEMED_BUILD_SPEC.md`;
> this doc explains the *code*.

## What this phase delivers

The repo skeleton and all the tooling the later phases build on:

- A git repo with a `.gitignore` (and later a `.gitattributes` for line endings).
- A `backend/` npm project with every dependency the spec lists (Phase 0 task 3).
- TypeScript configured **strict** (Phase 0 task 4).
- npm scripts: `dev`, `build`, `start`, `test`, `test:unit`, `test:integration`, `lint`.
- Jest configured with a 30s timeout for integration tests.
- ESLint + Prettier so the codebase stays consistent.
- `src/config/env.ts`: every environment variable is read once, validated with **zod**,
  and the process crashes at boot if the config is invalid (Phase 0 task 7).
- `backend/.env.example` documenting every variable (Phase 0 task 8).

**Exit criteria met:** `npm run build` and `npm test` succeed (tests pass with
`--passWithNoTests` because there were none yet).

## Files created

| File | What it is |
|---|---|
| `.gitignore` | Files git must never track |
| `.gitattributes` | Forces LF line endings on every text file (added in commit `6aaa502`, but it is tooling) |
| `backend/package.json` | Project metadata, dependencies, scripts |
| `backend/tsconfig.json` | TypeScript compiler settings for `src/` |
| `backend/tsconfig.test.json` | TypeScript settings for tests (extends the main one) |
| `backend/jest.config.ts` | Jest test-runner configuration |
| `backend/eslint.config.mjs` | ESLint rules |
| `backend/.prettierrc` | Prettier formatting rules |
| `backend/.env.example` | Documented template for environment variables |
| `backend/src/config/env.ts` | Reads + validates env with zod; exports the frozen config |
| `backend/tests/setup.ts` | Seeds a valid env before any test module is imported |
| `backend/tests/unit/env.test.ts` | Unit tests for `parseEnv` |

**Commits:** `ca80e0f` (init + tooling), `79a8784` (validated env config), `4cc0ced`
(require `CORS_ORIGIN` in production), `c54fdb7` (env tests + jest setup). Later tooling
commits: `89985bd` (prettier format pass), `6aaa502` (`.gitattributes`).

---

## Deep dive — `backend/package.json`

### Scripts

| Script | Command | What it does |
|---|---|---|
| `dev` | `ts-node-dev --respawn --transpile-only src/server.ts` | Hot-reloading dev server. `--transpile-only` skips type-checking for speed (so run `build` to catch type errors). |
| `build` | `tsc` | Compiles `src/` → `dist/` with full type-checking. |
| `start` | `node dist/server.js` | Runs the compiled server (production-ish). |
| `test` | `jest --passWithNoTests` | All tests. `--passWithNoTests` keeps CI green before any test exists. |
| `test:unit` | `jest tests/unit --passWithNoTests` | Unit tests only. |
| `test:integration` | `jest tests/integration --passWithNoTests` | Integration tests only. |
| `test:coverage` | `jest --coverage --passWithNoTests` | Tests + coverage report; **fails** unless the coverage threshold is met (see jest.config). |
| `lint` | `eslint "src/**/*.ts"` | Lints only `src/` (tests are linted by the same config when you run eslint directly). |

### Dependencies (runtime)

| Package | Why it is here |
|---|---|
| `express` | The HTTP framework. |
| `cors` | CORS middleware (browser origins). |
| `helmet` | Security headers. |
| `express-rate-limit` | Rate limiting for auth endpoints (Phase 3). |
| `mongoose` | MongoDB ODM (models, indexes, transactions). |
| `zod` | Runtime validation of env vars and request bodies. |
| `jsonwebtoken` | JWT signing/verification (Phase 3). |
| `bcryptjs` | Password hashing (Phase 3). |
| `ioredis` | Redis client (Phase 8 cache). |
| `dotenv` | Loads `.env` into `process.env` (imported by `env.ts`). |

### Dev dependencies

`typescript`, `ts-node-dev`, `@types/*` (node, express, cors, jsonwebtoken, bcryptjs, jest,
supertest), `jest`, `ts-jest`, `supertest`, `mongodb-memory-server` (in-memory Mongo for
integration tests), `eslint`, `typescript-eslint`, `prettier`.

> Note: `@types/express` is v5 while `express` is v4. This mismatch exists because v5 types
> were the latest at install time. It compiles cleanly today (the code uses only APIs that
> exist in both), so it was left alone. If a future change trips over it, pin
> `@types/express@^4`.

---

## Deep dive — `backend/tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",          // modern JS output (async/await, etc.)
    "module": "commonjs",        // Node's module system
    "moduleResolution": "node",  // classic node_modules resolution
    "lib": ["ES2022"],           // standard library types
    "outDir": "dist",            // compiled output
    "rootDir": "src",            // only src/ is compiled; tests are type-checked separately
    "strict": true,              // ALL strictness flags on (spec requirement)
    "noUncheckedIndexedAccess": true, // array[i] is `T | undefined` — forces null checks
    "noImplicitOverride": true,  // `override` keyword required when overriding a class member
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,     // `import express from 'express'` works
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,        // don't type-check .d.ts files (fast; tolerates @types mismatches)
    "sourceMap": true,           // debugging support
    "declaration": false,
    "types": ["node"]            // only @types/node is auto-included
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`noUncheckedIndexedAccess` is the strictness that matters most: `segments[0]` is typed
`string | undefined`, so the code must handle the undefined case (you'll see `if (id === undefined)` checks in `postUrl.ts`).

## Deep dive — `backend/tsconfig.test.json`

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",          // tests live outside src/, so allow both
    "noEmit": true,          // tests are never compiled to files (ts-jest runs them)
    "types": ["node", "jest"] // add jest globals (describe/it/expect)
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Jest (via ts-jest) uses this file — see `jest.config.ts` → `transform`.

## Deep dive — `backend/jest.config.ts`

```ts
preset: 'ts-jest',                 // runs TS tests without a build step
testEnvironment: 'node',           // no jsdom — this is a server
roots: ['<rootDir>/tests'],        // only tests/ is scanned
setupFiles: ['<rootDir>/tests/setup.ts'], // runs BEFORE test modules import anything
testTimeout: 30000,                // integration tests boot an in-memory Mongo replica set
transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }] },
collectCoverageFrom: ['src/domain/payout.ts', 'src/domain/milestones.ts'], // coverage scope
coverageThreshold: { global: { branches: 100, functions: 100, lines: 100, statements: 100 } },
clearMocks: true,
verbose: true,
```

Key points:

- **Coverage is scoped to the two money modules** (`payout.ts`, `milestones.ts`) and must be
  **100%** on all four metrics. That is the Phase 1 exit criterion, enforced by
  `npm run test:coverage`. Other files are not covered by the gate.
- `setupFiles` runs before imports, which matters because `env.ts` validates `process.env`
  **at import time** (see below).

## Deep dive — `backend/eslint.config.mjs`

```js
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,        // base JS rules
  ...tseslint.configs.recommended,   // TS rules
  {
    languageOptions: { parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

The `^_` ignore patterns are why unused parameters are written `_req`, `_res`, `_next` —
ESLint allows them because they start with an underscore.

## Deep dive — `backend/.prettierrc`

```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

- Semicolons, single quotes, trailing commas everywhere, 100-column lines.
- There is **no `endOfLine` setting**, so Prettier defaults to `lf`. That is why
  `.gitattributes` matters on Windows (see below).

## Deep dive — `.gitattributes`

```
* text=auto eol=lf
```

On Windows, git's `core.autocrlf=true` rewrites checkouts to CRLF, which makes Prettier
report every file as "wrong" (it expects LF). This file forces **every text file to LF in
both the repo and the working tree**, so formatting is identical on all machines. If you
ever see a Prettier failure on a file you didn't touch, this is usually the cause.

## Deep dive — `.gitignore`

Ignores `node_modules/`, build output (`dist/`, `build/`, `.next/`, `out/`), env files
(`.env`, `.env.*` — but **keeps** `.env.example` via `!.env.example`), coverage, logs,
editor folders, and the OpenWork local runtime folder.

---

## Deep dive — `backend/src/config/env.ts` (the heart of Phase 0)

This file is imported by almost everything, so it must be understood first.

### The zod schema

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  CORS_ORIGIN: z.string().optional(),
  REDIS_URL: z.string().min(1).optional(),
  CAMPAIGN_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  SPIKE_MIN_DELTA: z.coerce.number().int().nonnegative().default(10000),
  SPIKE_RATE_PER_MIN: z.coerce.number().positive().default(1000),
})
```

- `z.coerce.number()` converts a string like `"4000"` to the number `4000` (env vars are
  always strings).
- `JWT_SECRET` is required and ≥ 32 chars — enforced at boot, so a weak secret can never
  slip into production.
- `CORS_ORIGIN` and `REDIS_URL` are optional (no default, so a missing value is visible).

### The production check (`superRefine`)

```ts
.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    const origins = (value.CORS_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean);
    if (origins.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGIN'], message: 'CORS_ORIGIN is required in production' });
    }
  }
})
```

A missing `CORS_ORIGIN` is fine in development (fallback below) but **fatal in production** —
an API with no CORS allowlist would be unreachable from a browser frontend.

### The transform

```ts
.transform((value) => ({
  ...value,
  CORS_ORIGIN: value.CORS_ORIGIN ?? 'http://localhost:3000',
}))
```

Development fallback for the CORS origin.

### `stripEmpty`

```ts
function stripEmpty(raw: NodeJS.ProcessEnv): Record<string, unknown> {
  // drops keys whose value is '' or undefined
}
```

An empty string in `.env` (`REDIS_URL=`) is treated as "unset". This is why
`REDIS_URL=` in `.env.example` yields `undefined`, not `''`.

### `parseEnv` and the `env` singleton

```ts
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(stripEmpty(raw));
  if (!result.success) {
    // throws with a readable list of every invalid variable
  }
  return result.data;
}

export const env: Env = Object.freeze(parseEnv(process.env));
```

- `parseEnv` is exported separately so tests can feed it arbitrary records without touching
  the real `process.env` (that is what `env.test.ts` does).
- `env` is evaluated **once, at import time**, and frozen. If a required variable is
  missing, the process throws immediately — "crash fast at boot".

### Helpers

```ts
export function corsOrigins(config: Env = env): string[] {
  return config.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
}

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
```

`corsOrigins()` feeds the `cors` middleware in `app.ts`. `isTest` is used by the auth rate
limiter (Phase 3) to disable it during tests.

## Deep dive — `backend/tests/setup.ts`

```ts
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/memed-test?replicaSet=rs0';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-that-is-at-least-32-characters-long';
```

Because `env.ts` validates `process.env` at import time, **any test that imports a module
which imports `env.ts` would crash** without a valid env. This file (run by Jest's
`setupFiles`) seeds the three required variables before anything is imported. Note the
`??` — if you set these yourself when running tests, your values win.

## Deep dive — `backend/tests/unit/env.test.ts`

Tests `parseEnv` directly (no real `process.env` involved):

- defaults for a minimal valid env (`NODE_ENV=development`, `PORT=4000`, `JWT_EXPIRES_IN=7d`,
  `CORS_ORIGIN=http://localhost:3000`, `CAMPAIGN_CACHE_TTL_SECONDS=30`, spike defaults,
  `REDIS_URL` undefined);
- numeric strings are coerced (`PORT: '5000'` → `5000`);
- empty string is treated as unset;
- `JWT_SECRET` < 32 chars throws;
- missing `MONGODB_URI` throws;
- production without `CORS_ORIGIN` throws;
- production with an explicit `CORS_ORIGIN` passes.

---

## How to change things in Phase 0

| You want to… | Do this |
|---|---|
| Add a new env variable | 1) Add it to the `envSchema` in `src/config/env.ts`; 2) document it in `backend/.env.example`; 3) if tests need it, seed it in `tests/setup.ts`. |
| Change the default port | Edit `PORT` default in `envSchema` (and `.env.example`). |
| Change the JWT lifetime | `JWT_EXPIRES_IN` in `.env` (default `7d`). |
| Add a dependency | `npm install <pkg>` (runtime) or `npm install -D <pkg>` (dev) in `backend/`. |
| Change lint rules | `backend/eslint.config.mjs`. |
| Change formatting | `backend/.prettierrc` (then run `npx prettier --write "src/**/*.ts" "tests/**/*.ts"`). |
| Add a test file | Put it in `backend/tests/unit/` or `backend/tests/integration/` — Jest picks it up automatically. |
| Change the coverage gate | `jest.config.ts` → `collectCoverageFrom` / `coverageThreshold`. |
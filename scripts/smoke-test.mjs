#!/usr/bin/env node
/**
 * Production smoke test for the Meme'd API.
 *
 * Dependency-free: uses only the Node 20+ built-in `fetch` (no packages).
 * It walks the full brand + creator flow against a running backend and prints
 * one PASS/FAIL line per step. It exits 0 when every step passes and 1 on the
 * first failure.
 *
 * Usage:
 *   BASE_URL=https://your-backend.example node scripts/smoke-test.mjs
 *
 * `BASE_URL` defaults to http://localhost:4000 when unset.
 */

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Per-request timeout. Free-tier backends can take ~30-60s to wake up. */
const REQUEST_TIMEOUT_MS = 90_000;
/** The health check is attempted this many times before the run fails. */
const HEALTH_MAX_ATTEMPTS = 3;
/** Wait between health-check attempts. */
const HEALTH_RETRY_WAIT_MS = 20_000;
/** Number of steps in the flow (used only for the [n/total] labels). */
const TOTAL_STEPS = 9;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * One HTTP request with a hard timeout. Returns the status and parsed JSON.
 * Tokens are never logged anywhere in this script.
 */
async function request(method, path, { token, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  } catch (error) {
    const reason =
      error?.name === 'AbortError'
        ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : (error?.message ?? String(error));
    throw new Error(
      `${method} ${path} failed: ${reason} (the free tier may be waking up - retry in a moment)`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** GET /health, retried a few times so a cold free-tier instance can wake up. */
async function healthCheck() {
  let lastError;
  for (let attempt = 1; attempt <= HEALTH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await request('GET', '/health');
      if (response.status === 200) {
        return response;
      }
      lastError = new Error(`GET /health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < HEALTH_MAX_ATTEMPTS) {
      log(
        `      health check attempt ${attempt}/${HEALTH_MAX_ATTEMPTS} failed - ` +
          `retrying in ${HEALTH_RETRY_WAIT_MS / 1000}s (the free tier may be waking up)`,
      );
      await sleep(HEALTH_RETRY_WAIT_MS);
    }
  }
  throw lastError;
}

/** Runs one step, prints its PASS/FAIL line, and exits 1 on the first failure. */
async function step(number, title, run) {
  const label = `[${number}/${TOTAL_STEPS}] ${title}`;
  try {
    const detail = await run();
    log(`${label} ... PASS`);
    if (detail) {
      log(`      ${detail}`);
    }
  } catch (error) {
    log(`${label} ... FAIL`);
    log(`      ${error.message}`);
    log('');
    log(`Smoke test FAILED at step ${number}.`);
    process.exit(1);
  }
}

async function main() {
  log("Meme'd API smoke test");
  log(`Base URL: ${BASE_URL}`);
  log('');

  const stamp = Date.now();
  const password = 'smoke-pass-123';
  const brandEmail = `smoke-brand-${stamp}@example.com`;
  const creatorEmail = `smoke-creator-${stamp}@example.com`;
  const postUrl = `https://www.instagram.com/reel/smoke${stamp}${Math.random().toString(36).slice(2, 8)}/`;

  let brandToken;
  let creatorToken;
  let campaignId;
  let submissionId;

  await step(1, 'GET /health returns 200', async () => {
    const response = await healthCheck();
    assertEqual(response.status, 200, 'status');
    return `200, db=${response.json?.db ?? 'unknown'}`;
  });

  await step(2, 'Sign up a brand and a creator', async () => {
    const brand = await request('POST', '/api/auth/signup', {
      body: { name: 'Smoke Brand', email: brandEmail, password, role: 'brand' },
    });
    assertEqual(brand.status, 201, 'brand signup status');
    assert(typeof brand.json?.token === 'string' && brand.json.token.length > 0, 'brand token missing');
    brandToken = brand.json.token;

    const creator = await request('POST', '/api/auth/signup', {
      body: { name: 'Smoke Creator', email: creatorEmail, password, role: 'creator' },
    });
    assertEqual(creator.status, 201, 'creator signup status');
    assert(
      typeof creator.json?.token === 'string' && creator.json.token.length > 0,
      'creator token missing',
    );
    creatorToken = creator.json.token;

    return `brand ${brand.json.user?.id}, creator ${creator.json.user?.id}`;
  });

  await step(3, 'Brand creates an Instagram campaign (budget 10000, ladder 1000->100, 5000->400)', async () => {
    const response = await request('POST', '/api/campaigns', {
      token: brandToken,
      body: {
        name: 'Smoke Campaign',
        platform: 'instagram',
        budget: 10000,
        // Sent out of order on purpose: the service must sort the ladder.
        milestones: [
          { views: 5000, payout: 400 },
          { views: 1000, payout: 100 },
        ],
      },
    });
    assertEqual(response.status, 201, 'status');
    const campaign = response.json?.campaign;
    assert(campaign, 'campaign missing from response');
    campaignId = campaign.id;
    assertEqual(campaign.spent, 0, 'spent');
    assertEqual(campaign.remaining, 10000, 'remaining');
    assertEqual(campaign.budget, 10000, 'budget');
    assert(Array.isArray(campaign.milestones) && campaign.milestones.length === 2, 'milestones length');
    assertEqual(campaign.milestones[0].views, 1000, 'milestones[0].views');
    assertEqual(campaign.milestones[0].payout, 100, 'milestones[0].payout');
    assertEqual(campaign.milestones[1].views, 5000, 'milestones[1].views');
    assertEqual(campaign.milestones[1].payout, 400, 'milestones[1].payout');
    return `campaign ${campaignId}: spent 0, remaining 10000, milestones sorted`;
  });

  await step(4, 'Creator lists campaigns and the new campaign is present', async () => {
    const response = await request('GET', '/api/campaigns?page=1&limit=20', { token: creatorToken });
    assertEqual(response.status, 200, 'status');
    const items = response.json?.items;
    assert(Array.isArray(items), 'items missing from response');
    assert(
      items.some((campaign) => campaign.id === campaignId),
      `campaign ${campaignId} not in the live list`,
    );
    return `found among ${items.length} live campaign(s)`;
  });

  await step(5, 'Creator submits a post (201, zero amounts); the same URL again returns 409', async () => {
    const created = await request('POST', '/api/submissions', {
      token: creatorToken,
      body: { campaignId, postUrl },
    });
    assertEqual(created.status, 201, 'status');
    const submission = created.json?.submission;
    assert(submission, 'submission missing from response');
    submissionId = submission.id;
    assertEqual(submission.views, 0, 'views');
    assertEqual(submission.entitledAmount, 0, 'entitledAmount');
    assertEqual(submission.paidAmount, 0, 'paidAmount');

    const duplicate = await request('POST', '/api/submissions', {
      token: creatorToken,
      body: { campaignId, postUrl },
    });
    assertEqual(duplicate.status, 409, 'duplicate status');
    return `submission ${submissionId}; duplicate rejected with 409`;
  });

  await step(6, 'PATCH views: 1000 pays 100, repeat pays 0, 5000 pays 300 more, 2000 (decrease) pays 0', async () => {
    const first = await request('PATCH', `/api/submissions/${submissionId}/views`, {
      body: { views: 1000 },
    });
    assertEqual(first.status, 200, 'first status');
    assertEqual(first.json?.payout?.delta, 100, 'first delta');
    assertEqual(first.json?.payout?.paidAmount, 100, 'first paidAmount');

    const repeat = await request('PATCH', `/api/submissions/${submissionId}/views`, {
      body: { views: 1000 },
    });
    assertEqual(repeat.status, 200, 'repeat status');
    assertEqual(repeat.json?.payout?.delta, 0, 'repeat delta');
    assertEqual(repeat.json?.payout?.paidAmount, 100, 'repeat paidAmount');

    const climb = await request('PATCH', `/api/submissions/${submissionId}/views`, {
      body: { views: 5000 },
    });
    assertEqual(climb.status, 200, 'climb status');
    assertEqual(climb.json?.payout?.delta, 300, 'climb delta');
    assertEqual(climb.json?.payout?.paidAmount, 400, 'climb paidAmount');

    const decrease = await request('PATCH', `/api/submissions/${submissionId}/views`, {
      body: { views: 2000 },
    });
    assertEqual(decrease.status, 200, 'decrease status');
    assertEqual(decrease.json?.payout?.delta, 0, 'decrease delta');
    assertEqual(decrease.json?.payout?.paidAmount, 400, 'decrease paidAmount');

    return 'paid 100 -> 100 -> 400 -> 400';
  });

  await step(7, 'Creator earnings show totalEarnings 400', async () => {
    const response = await request('GET', '/api/creators/me/earnings', { token: creatorToken });
    assertEqual(response.status, 200, 'status');
    assertEqual(response.json?.earnings?.totalEarnings, 400, 'totalEarnings');
    return 'totalEarnings 400';
  });

  await step(8, "Brand's campaign list shows spent 400 and remaining 9600", async () => {
    const response = await request('GET', '/api/campaigns/mine', { token: brandToken });
    assertEqual(response.status, 200, 'status');
    const items = response.json?.items;
    assert(Array.isArray(items), 'items missing from response');
    const campaign = items.find((item) => item.id === campaignId);
    assert(campaign, `campaign ${campaignId} not in the brand's list`);
    assertEqual(campaign.spent, 400, 'spent');
    assertEqual(campaign.remaining, 9600, 'remaining');
    return 'spent 400, remaining 9600';
  });

  await step(9, 'A creator token calling POST /api/campaigns returns 403', async () => {
    const response = await request('POST', '/api/campaigns', {
      token: creatorToken,
      body: {
        name: 'Should Not Exist',
        platform: 'instagram',
        budget: 1000,
        milestones: [{ views: 100, payout: 100 }],
      },
    });
    assertEqual(response.status, 403, 'status');
    return '403';
  });

  log('');
  log(`Smoke test PASSED - all ${TOTAL_STEPS} steps succeeded.`);
  process.exit(0);
}

main().catch((error) => {
  log(`Smoke test FAILED: ${error.message}`);
  process.exit(1);
});

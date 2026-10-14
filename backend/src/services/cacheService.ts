/**
 * Campaign cache invalidation hook.
 *
 * Phase 6 view updates call this after a *committed* payout (delta > 0) so the
 * creator live-campaign list cache can never serve stale `spent`/`remaining`
 * data. Real Redis caching is a Phase 8 bonus (`config/redis.ts`, key space
 * `campaigns:live:*`) and the app must work with no Redis present.
 *
 * Until Phase 8 this is a deliberate no-op: it keeps the call site stable and
 * lets the whole suite pass with no cache configured.
 */
export async function invalidateCampaignCache(): Promise<void> {
  // Intentionally empty — Phase 8 bumps `campaigns:live:version` here.
}

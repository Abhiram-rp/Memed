import Skeleton from "@/components/Skeleton";

/**
 * Placeholder that mirrors the shape of a campaign card — title, meta, budget
 * stats, progress bar and milestone ladder — while a campaign list loads.
 */
export default function CampaignCardSkeleton() {
  return (
    <article className="card skeleton-card" aria-hidden="true">
      <div className="row-between campaign-head">
        <div className="skeleton-stack">
          <Skeleton width="180px" height="1.05rem" />
          <Skeleton width="110px" height="0.8rem" />
        </div>
        <div className="row">
          <Skeleton width="72px" height="1.5rem" radius="999px" />
          <Skeleton width="60px" height="1.5rem" radius="999px" />
        </div>
      </div>

      <div className="budget-block">
        <div className="budget-stat">
          <Skeleton width="44px" height="0.7rem" />
          <Skeleton width="90px" height="1.3rem" />
        </div>
        <div className="budget-stat">
          <Skeleton width="60px" height="0.7rem" />
          <Skeleton width="90px" height="1.3rem" />
        </div>
        <div className="budget-stat budget-stat--total">
          <Skeleton width="44px" height="0.7rem" />
          <Skeleton width="80px" height="1rem" />
        </div>
      </div>

      <Skeleton className="skeleton-bar" width="100%" height="10px" radius="999px" />

      <div className="skeleton-stack skeleton-ladder">
        <Skeleton width="55%" height="0.9rem" />
        <Skeleton width="48%" height="0.9rem" />
        <Skeleton width="62%" height="0.9rem" />
      </div>
    </article>
  );
}

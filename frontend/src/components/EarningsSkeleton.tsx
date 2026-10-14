import Skeleton from "@/components/Skeleton";

/** Placeholder that mirrors the earnings hero while it loads. */
export default function EarningsSkeleton() {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      <Skeleton width="120px" height="0.7rem" />
      <Skeleton width="240px" height="2.6rem" />
      <Skeleton width="170px" height="0.9rem" />
      <div className="skeleton-stack skeleton-breakdown">
        <Skeleton width="100%" height="1rem" />
        <Skeleton width="100%" height="1rem" />
      </div>
    </div>
  );
}

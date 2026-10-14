import type { CampaignStatus } from "@/types/api";

/** Campaign status pill: live -> green, exhausted -> red. */
export default function StatusBadge({ status }: { status: CampaignStatus }) {
  const live = status === "live";

  return (
    <span className={`badge ${live ? "badge-green" : "badge-red"}`}>
      {live ? "Live" : "Exhausted"}
    </span>
  );
}

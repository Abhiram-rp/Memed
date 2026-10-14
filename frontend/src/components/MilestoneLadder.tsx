import Money from "@/components/Money";
import { formatNumber } from "@/lib/format";
import type { Milestone } from "@/types/api";

/** Compact, ascending list of view thresholds and the payout each unlocks. */
export default function MilestoneLadder({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return <p className="muted">No milestones.</p>;
  }

  const ordered = [...milestones].sort((a, b) => a.views - b.views);

  return (
    <ul className="milestone-ladder">
      {ordered.map((milestone) => (
        <li key={`${milestone.views}:${milestone.payout}`}>
          {formatNumber(milestone.views)} views → <Money value={milestone.payout} />
        </li>
      ))}
    </ul>
  );
}

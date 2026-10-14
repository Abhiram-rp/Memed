import Money from "@/components/Money";
import { formatNumber } from "@/lib/format";
import type { Milestone } from "@/types/api";

/**
 * The milestone ladder as a small vertical stepper: numbered nodes on a rail,
 * each showing the view threshold and the payout it unlocks. Ascending by views.
 */
export default function MilestoneLadder({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return <p className="muted">No milestones.</p>;
  }

  const ordered = [...milestones].sort((a, b) => a.views - b.views);

  return (
    <ol className="ladder">
      {ordered.map((milestone, index) => (
        <li className="ladder-step" key={`${milestone.views}:${milestone.payout}`}>
          <span className="ladder-node" aria-hidden="true">
            {index + 1}
          </span>
          <span className="ladder-body">
            <span className="ladder-views">{formatNumber(milestone.views)} views</span>
            <span className="ladder-arrow" aria-hidden="true">
              →
            </span>
            <span className="ladder-payout">
              <Money value={milestone.payout} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

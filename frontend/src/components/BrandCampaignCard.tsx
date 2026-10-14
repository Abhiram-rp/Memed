"use client";

/**
 * One campaign card on the brand dashboard (spec Phase 7): name, platform,
 * status, submission count, budget usage and the milestone ladder. A toggle
 * lazily loads that campaign's submissions on first expand; a Refresh button
 * re-fetches them.
 */

import { useState } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import MilestoneLadder from "@/components/MilestoneLadder";
import Money from "@/components/Money";
import ProgressBar from "@/components/ProgressBar";
import Spinner from "@/components/Spinner";
import StatusBadge from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { Campaign, Submission } from "@/types/api";

export default function BrandCampaignCard({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submissionCount = campaign.submissionCount ?? 0;

  async function loadSubmissions(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await api.campaigns.submissions(campaign.id);
      setSubmissions(result.items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function handleToggle(): void {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (submissions === null) {
      void loadSubmissions();
    }
  }

  return (
    <article className="card">
      <div className="row-between">
        <h3 className="card-title">{campaign.name}</h3>
        <div className="row">
          <span className="badge badge-gray">
            {campaign.platform === "instagram" ? "Instagram" : "YouTube"}
          </span>
          <StatusBadge status={campaign.status} />
        </div>
      </div>

      <p className="muted">
        {submissionCount} submission{submissionCount === 1 ? "" : "s"}
      </p>

      <div className="row-between">
        <span>
          <span className="muted">Budget</span> <Money value={campaign.budget} />
        </span>
        <span>
          <span className="muted">Spent</span> <Money value={campaign.spent} />
        </span>
        <span>
          <span className="muted">Remaining</span> <Money value={campaign.remaining} />
        </span>
      </div>

      <ProgressBar value={campaign.spent} max={campaign.budget} />

      <MilestoneLadder milestones={campaign.milestones} />

      <button type="button" className="secondary" onClick={handleToggle}>
        {expanded ? "Hide submissions" : "Show submissions"}
      </button>

      {expanded && (
        <section>
          <div className="row-between">
            <h4>Submissions</h4>
            <button
              type="button"
              className="secondary"
              onClick={() => void loadSubmissions()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {error !== null && <ErrorMessage error={error} />}
          {submissions === null && error === null && <Spinner label="Loading submissions…" />}
          {submissions !== null && submissions.length === 0 && (
            <p className="muted">No submissions yet</p>
          )}
          {submissions !== null && submissions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Post</th>
                    <th>Views</th>
                    <th>Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => (
                    <tr key={submission.id}>
                      <td>{submission.creator?.name ?? "—"}</td>
                      <td>
                        <a href={submission.postUrl} target="_blank" rel="noopener noreferrer">
                          {submission.postUrl}
                        </a>
                      </td>
                      <td>{formatNumber(submission.views)}</td>
                      <td>
                        <Money value={submission.paidAmount} />
                      </td>
                      <td>
                        <div className="row">
                          {submission.capped && <span className="badge badge-yellow">Capped</span>}
                          {submission.flagged && (
                            <span
                              className="badge badge-red"
                              title={submission.flagReason ?? undefined}
                            >
                              Flagged
                            </span>
                          )}
                          {!submission.capped && !submission.flagged && (
                            <span className="muted">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </article>
  );
}

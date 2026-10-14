"use client";

/**
 * One campaign card on the brand dashboard (spec Phase 7): a clean dashboard
 * block with the platform pill, status badge, a prominent Spent / Remaining
 * budget block, the budget progress bar and the milestone ladder stepper. A
 * toggle lazily loads that campaign's submissions on first expand; a Refresh
 * button re-fetches them.
 */

import { useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorMessage from "@/components/ErrorMessage";
import MilestoneLadder from "@/components/MilestoneLadder";
import Money from "@/components/Money";
import ProgressBar from "@/components/ProgressBar";
import StatusBadge from "@/components/StatusBadge";
import SubmissionsSkeleton from "@/components/SubmissionsSkeleton";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { Campaign, Submission } from "@/types/api";

const PLATFORM_LABEL: Record<Campaign["platform"], string> = {
  instagram: "Instagram",
  youtube: "YouTube",
};

const SUBMISSION_COLUMNS = ["Creator", "Post", "Views", "Paid", "Status"];

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
    <article className="card campaign-card">
      <div className="row-between campaign-head">
        <h3 className="card-title">{campaign.name}</h3>
        <div className="row">
          <span className="pill">{PLATFORM_LABEL[campaign.platform]}</span>
          <StatusBadge status={campaign.status} />
        </div>
      </div>

      <p className="campaign-meta muted">
        {submissionCount} submission{submissionCount === 1 ? "" : "s"}
      </p>

      <div className="budget-block">
        <div className="budget-stat">
          <span className="budget-label">Spent</span>
          <span className="budget-value display">
            <Money value={campaign.spent} />
          </span>
        </div>
        <div className="budget-stat">
          <span className="budget-label">Remaining</span>
          <span className="budget-value display">
            <Money value={campaign.remaining} />
          </span>
        </div>
        <div className="budget-stat budget-stat--total">
          <span className="budget-label">Budget</span>
          <span className="budget-value">
            <Money value={campaign.budget} />
          </span>
        </div>
      </div>

      <ProgressBar value={campaign.spent} max={campaign.budget} />

      <div className="campaign-ladder">
        <h4>Milestone ladder</h4>
        <MilestoneLadder milestones={campaign.milestones} />
      </div>

      <div className="campaign-actions">
        <button type="button" className="secondary" onClick={handleToggle}>
          {expanded ? "Hide submissions" : "Show submissions"}
        </button>
      </div>

      {expanded && (
        <section className="submissions">
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
          {submissions === null && error === null && (
            <>
              <p className="visually-hidden" role="status">
                Loading submissions…
              </p>
              <SubmissionsSkeleton columns={SUBMISSION_COLUMNS} />
            </>
          )}
          {submissions !== null && submissions.length === 0 && (
            <EmptyState
              title="No submissions yet"
              description="Submissions appear here once creators post to this campaign."
            />
          )}
          {submissions !== null && submissions.length > 0 && (
            <div className="table-wrap submissions-table-wrap">
              <table className="submissions-table">
                <thead>
                  <tr>
                    <th scope="col">Creator</th>
                    <th scope="col">Post</th>
                    <th scope="col">Views</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => (
                    <tr key={submission.id}>
                      <td data-label="Creator">{submission.creator?.name ?? "—"}</td>
                      <td data-label="Post">
                        <a
                          className="post-link"
                          href={submission.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {submission.postUrl}
                          <span className="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      </td>
                      <td data-label="Views">{formatNumber(submission.views)}</td>
                      <td data-label="Paid">
                        <Money value={submission.paidAmount} />
                      </td>
                      <td data-label="Status">
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

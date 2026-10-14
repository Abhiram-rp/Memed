"use client";

/**
 * The creator's own submissions (spec Phase 7): a table of every post they have
 * submitted, newest first, with a per-row demo control that simulates platform
 * view data. Each row owns its own input/message state (keyed by submission id)
 * so a refresh never mixes rows up, and every successful update calls the page's
 * `onRefresh` so earnings, the campaign list and this table all re-fetch.
 */

import { useEffect, useState } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import Money from "@/components/Money";
import Spinner from "@/components/Spinner";
import { api } from "@/lib/api";
import { formatINR, formatNumber } from "@/lib/format";
import type { Submission } from "@/types/api";

/** Largest absolute view count the API accepts (spec §5.4). */
const MAX_VIEWS = 2_000_000_000;

const INTEGER_PATTERN = /^\d+$/;

export default function MySubmissions({
  refreshToken,
  onRefresh,
}: {
  refreshToken: number;
  onRefresh: () => void;
}) {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setError(null);
      try {
        const result = await api.submissions.mine();
        if (!cancelled) {
          setSubmissions(result.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <section>
      <h2>My submissions</h2>

      {error !== null && <ErrorMessage error={error} />}
      {submissions === null && error === null && <Spinner label="Loading submissions…" />}
      {submissions !== null && submissions.length === 0 && (
        <p className="muted">You haven&apos;t submitted any posts yet.</p>
      )}

      {submissions !== null && submissions.length > 0 && (
        <>
          <p className="hint">Demo: simulate platform data</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Post</th>
                  <th>Views</th>
                  <th>Entitled</th>
                  <th>Paid</th>
                  <th>Status</th>
                  <th>Simulate</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <SubmissionRow
                    key={submission.id}
                    submission={submission}
                    onRefresh={onRefresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function SubmissionRow({
  submission,
  onRefresh,
}: {
  submission: Submission;
  onRefresh: () => void;
}) {
  const [views, setViews] = useState(String(submission.views));
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function handleUpdate(): Promise<void> {
    const trimmed = views.trim();
    if (!INTEGER_PATTERN.test(trimmed)) {
      setClientError("Enter a whole number of views.");
      setMessage(null);
      return;
    }
    const value = Number(trimmed);
    if (value > MAX_VIEWS) {
      setClientError(`Views must be between 0 and ${formatNumber(MAX_VIEWS)}.`);
      setMessage(null);
      return;
    }

    setClientError(null);
    setError(null);
    setMessage(null);
    setUpdating(true);
    try {
      const result = await api.submissions.updateViews(submission.id, value);
      const { payout } = result;
      let text = payout.delta > 0 ? `Paid +${formatINR(payout.delta)}` : "No new payout";
      if (payout.capped) {
        text += " (budget ran out - capped)";
      }
      setMessage(text);
      onRefresh();
    } catch (err) {
      setError(err);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <tr>
      <td>
        <div className="row">
          <span>{submission.campaign?.name ?? "—"}</span>
          {submission.campaign !== undefined && (
            <span className="badge badge-gray">
              {submission.campaign.platform === "instagram" ? "Instagram" : "YouTube"}
            </span>
          )}
        </div>
      </td>
      <td>
        <a href={submission.postUrl} target="_blank" rel="noopener noreferrer">
          {submission.postUrl}
        </a>
      </td>
      <td>{formatNumber(submission.views)}</td>
      <td>
        <Money value={submission.entitledAmount} />
      </td>
      <td>
        <Money value={submission.paidAmount} />
      </td>
      <td>
        <div className="row">
          {submission.capped && <span className="badge badge-yellow">Capped</span>}
          {submission.flagged && (
            <span className="badge badge-red" title={submission.flagReason ?? undefined}>
              Flagged
            </span>
          )}
          {!submission.capped && !submission.flagged && <span className="muted">—</span>}
        </div>
      </td>
      <td className="simulate-views">
        <div className="row">
          <input
            type="number"
            min={0}
            max={MAX_VIEWS}
            value={views}
            onChange={(event) => setViews(event.target.value)}
            aria-label={`Views for ${submission.postUrl}`}
            disabled={updating}
          />
          <button type="button" className="secondary" onClick={handleUpdate} disabled={updating}>
            {updating ? "Updating…" : "Update views"}
          </button>
        </div>
        {clientError !== null && (
          <div className="error" role="alert">
            <p>{clientError}</p>
          </div>
        )}
        {error !== null && <ErrorMessage error={error} />}
        {message !== null && <p className="success">{message}</p>}
      </td>
    </tr>
  );
}

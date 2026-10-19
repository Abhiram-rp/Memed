"use client";

/**
 * The creator's own submissions (spec Phase 7): every post they have submitted,
 * newest first, with a per-row demo control that simulates platform view data.
 * The table collapses into stacked cards on narrow screens. Each row owns its
 * own input/result state (keyed by submission id) so a refresh never mixes rows
 * up, and every successful update calls the page's `onRefresh` so earnings, the
 * campaign list and this table all re-fetch.
 */

import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorMessage from "@/components/ErrorMessage";
import Money from "@/components/Money";
import SubmissionsSkeleton from "@/components/SubmissionsSkeleton";
import { api } from "@/lib/api";
import { formatINR, formatNumber } from "@/lib/format";
import type { Submission } from "@/types/api";

/** Largest absolute view count the API accepts (spec §5.4). */
const MAX_VIEWS = 2_000_000_000;

const SUBMISSION_COLUMNS = ["Campaign", "Post", "Views", "Entitled", "Paid", "Status", "Simulate"];

const INTEGER_PATTERN = /^\d+$/;

/** How long a payout result chip stays on screen before it fades away. */
const RESULT_TIMEOUT_MS = 4000;

type ResultTone = "ok" | "muted" | "warn";

interface RowResult {
  tone: ResultTone;
  text: string;
}

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
          description="Submit a post to a live campaign and it will show up here."
        />
      )}

      {submissions !== null && submissions.length > 0 && (
        <>
          <div className="demo-strip">
            <span className="demo-strip-dot" aria-hidden="true" />
            <span>Demo: simulate platform data</span>
          </div>
          <div className="table-wrap submissions-table-wrap">
            <table className="submissions-table">
              <thead>
                <tr>
                  <th scope="col">Campaign</th>
                  <th scope="col">Post</th>
                  <th scope="col">Views</th>
                  <th scope="col">Entitled</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Status</th>
                  <th scope="col">Simulate</th>
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
  const [result, setResult] = useState<RowResult | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [clientError, setClientError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Auto-dismiss the payout chip. `result` is a fresh object on every update, so
  // this effect re-runs (and the timer resets) each time a new result appears.
  useEffect(() => {
    if (result === null) {
      return;
    }
    const timer = window.setTimeout(() => setResult(null), RESULT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  function showResult(tone: ResultTone, text: string): void {
    setResult({ tone, text });
    // Bump the key so the chip remounts and its fade-in replays.
    setResultKey((key) => key + 1);
  }

  async function handleUpdate(): Promise<void> {
    const trimmed = views.trim();
    if (!INTEGER_PATTERN.test(trimmed)) {
      setClientError("Enter a whole number of views.");
      setResult(null);
      return;
    }
    const value = Number(trimmed);
    if (value > MAX_VIEWS) {
      setClientError(`Views must be between 0 and ${formatNumber(MAX_VIEWS)}.`);
      setResult(null);
      return;
    }

    setClientError(null);
    setError(null);
    setResult(null);
    setUpdating(true);
    try {
      const response = await api.submissions.updateViews(submission.id, value);
      const { payout } = response;
      if (payout.capped) {
        showResult(
          "warn",
          payout.delta > 0
            ? `Paid +${formatINR(payout.delta)} · budget ran out (capped)`
            : "Budget ran out — capped",
        );
      } else if (payout.delta > 0) {
        showResult("ok", `Paid +${formatINR(payout.delta)}`);
      } else {
        showResult("muted", "No new payout");
      }
      onRefresh();
    } catch (err) {
      setError(err);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <tr>
      <td data-label="Campaign">
        <div className="row">
          <span>{submission.campaign?.name ?? "—"}</span>
          {submission.campaign !== undefined && (
            <span className="badge badge-gray">
              {submission.campaign.platform === "instagram" ? "Instagram" : "YouTube"}
            </span>
          )}
        </div>
      </td>
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
      <td data-label="Entitled">
        <Money value={submission.entitledAmount} />
      </td>
      <td data-label="Paid">
        <Money value={submission.paidAmount} />
      </td>
      <td data-label="Status">
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
      <td className="simulate-views" data-label="Simulate">
        <div className="row">
          <input
            type="number"
            min={0}
            max={MAX_VIEWS}
            value={views}
            onChange={(event) => setViews(event.target.value)}
            aria-label={`Views for ${submission.postUrl}`}
            disabled={updating}
            aria-invalid={clientError !== null}
            aria-describedby={clientError !== null ? `views-error-${submission.id}` : undefined}
          />
          <button type="button" className="secondary" onClick={handleUpdate} disabled={updating}>
            {updating ? "Updating…" : "Update views"}
          </button>
        </div>
        {clientError !== null && (
          <div className="error" role="alert">
            <p id={`views-error-${submission.id}`}>{clientError}</p>
          </div>
        )}
        {error !== null && <ErrorMessage error={error} />}
        {result !== null && (
          <p key={resultKey} className={`result-chip result-chip--${result.tone}`} role="status">
            {result.text}
          </p>
        )}
      </td>
    </tr>
  );
}

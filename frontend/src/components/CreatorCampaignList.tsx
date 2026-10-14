"use client";

/**
 * Live-campaign browser for creators (spec Phase 7): paginated cards, each with
 * a submit-post form. It re-fetches the page currently shown whenever
 * `refreshToken` changes, and steps back to a valid page if the current one
 * becomes empty after a refresh (for example when a campaign is exhausted).
 */

import { useEffect, useState } from "react";
import CampaignCardSkeleton from "@/components/CampaignCardSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorMessage from "@/components/ErrorMessage";
import MilestoneLadder from "@/components/MilestoneLadder";
import Money from "@/components/Money";
import StatusBadge from "@/components/StatusBadge";
import SubmitPostForm from "@/components/SubmitPostForm";
import { api } from "@/lib/api";
import type { CampaignListResponse } from "@/types/api";

const PAGE_SIZE = 10;

export default function CreatorCampaignList({
  refreshToken,
  onRefresh,
}: {
  refreshToken: number;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CampaignListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const result = await api.campaigns.list(page, PAGE_SIZE);
        if (cancelled) {
          return;
        }
        const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
        if (page > totalPages) {
          // The current page no longer exists (e.g. campaigns were exhausted);
          // fall back to the last valid page and let the effect re-fetch it.
          setPage(totalPages);
          return;
        }
        setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [page, refreshToken]);

  const totalPages = data !== null ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <section>
      <div className="row-between">
        <h2>Live campaigns</h2>
        <button type="button" className="secondary" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </div>

      {error !== null && <ErrorMessage error={error} />}
      {data === null && error === null && (
        <>
          <p className="visually-hidden" role="status">
            Loading campaigns…
          </p>
          <CampaignCardSkeleton />
          <CampaignCardSkeleton />
        </>
      )}
      {data !== null && data.items.length === 0 && (
        <EmptyState
          title="No live campaigns right now"
          description="New campaigns appear here as brands launch them. Check back soon."
        />
      )}

      {data !== null &&
        data.items.map((campaign) => (
          <article className="card" key={campaign.id}>
            <div className="row-between campaign-head">
              <div>
                <h3 className="card-title">{campaign.name}</h3>
                <p className="campaign-meta muted">{campaign.brand?.name ?? "Brand"}</p>
              </div>
              <div className="row">
                <span className="badge badge-gray">
                  {campaign.platform === "instagram" ? "Instagram" : "YouTube"}
                </span>
                <StatusBadge status={campaign.status} />
              </div>
            </div>

            <div className="campaign-remaining">
              <span className="budget-label">Remaining budget</span>
              <span className="campaign-remaining-value display">
                <Money value={campaign.remaining} />
              </span>
            </div>

            <div className="campaign-ladder">
              <h4>Milestones</h4>
              <MilestoneLadder milestones={campaign.milestones} />
            </div>

            <SubmitPostForm campaign={campaign} onSubmitted={onRefresh} />
          </article>
        ))}

      {data !== null && data.total > 0 && (
        <div className="row-between">
          <button
            type="button"
            className="secondary"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setPage((current) => current + 1)}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

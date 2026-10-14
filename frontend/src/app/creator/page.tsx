"use client";

/**
 * Creator dashboard (spec Phase 7): the earnings summary, the live-campaign
 * browser and the creator's own submissions. A single `refreshAll()` re-fetches
 * everything the page shows (earnings, the campaign page currently shown, and
 * the submissions) so child components can trigger a refresh.
 */

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import CreatorCampaignList from "@/components/CreatorCampaignList";
import EarningsSkeleton from "@/components/EarningsSkeleton";
import ErrorMessage from "@/components/ErrorMessage";
import Money from "@/components/Money";
import MySubmissions from "@/components/MySubmissions";
import PageHeader from "@/components/PageHeader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { api } from "@/lib/api";
import type { Earnings } from "@/types/api";

export default function CreatorDashboardPage() {
  return (
    <ProtectedRoute role="creator">
      <AppShell>
        <CreatorDashboard />
      </AppShell>
    </ProtectedRoute>
  );
}

function CreatorDashboard() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [earningsError, setEarningsError] = useState<unknown>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setEarningsError(null);
      try {
        const result = await api.creators.earnings();
        if (!cancelled) {
          setEarnings(result);
        }
      } catch (err) {
        if (!cancelled) {
          setEarningsError(err);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refreshAll = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  return (
    <>
      <PageHeader title="Creator dashboard" subtitle="Your hustle, tracked." />

      <section className="card earnings-hero">
        <h2 className="eyebrow">Total earnings</h2>
        {earningsError !== null && <ErrorMessage error={earningsError} />}
        {earnings === null && earningsError === null && (
          <>
            <p className="visually-hidden" role="status">
              Loading earnings…
            </p>
            <EarningsSkeleton />
          </>
        )}
        {earnings !== null && (
          <>
            <p className="earnings-total display">
              <Money value={earnings.totalEarnings} />
            </p>
            <p className="earnings-sub">
              {earnings.submissionCount} submission{earnings.submissionCount === 1 ? "" : "s"}
              {earnings.byCampaign.length > 0 &&
                ` across ${earnings.byCampaign.length} campaign${
                  earnings.byCampaign.length === 1 ? "" : "s"
                }`}
            </p>
            {earnings.submissionCount === 0 && (
              <p className="hint">Submit a post to a live campaign to start earning.</p>
            )}
            {earnings.byCampaign.length > 0 && (
              <ul className="breakdown earnings-breakdown">
                {earnings.byCampaign.map((row) => (
                  <li key={row.campaignId}>
                    <span className="breakdown-name">{row.campaignName}</span>
                    <span className="breakdown-meta">
                      {row.submissionCount} post{row.submissionCount === 1 ? "" : "s"}
                    </span>
                    <span className="breakdown-amount">
                      <Money value={row.paidAmount} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <CreatorCampaignList refreshToken={refreshToken} onRefresh={refreshAll} />

      <MySubmissions refreshToken={refreshToken} onRefresh={refreshAll} />
    </>
  );
}

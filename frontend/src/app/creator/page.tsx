"use client";

/**
 * Creator dashboard (spec Phase 7): the earnings summary and the live-campaign
 * browser. A single `refreshAll()` re-fetches everything the page shows
 * (earnings, the campaign page currently shown, and later the submissions) so
 * child components can trigger a refresh.
 */

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import CreatorCampaignList from "@/components/CreatorCampaignList";
import ErrorMessage from "@/components/ErrorMessage";
import Money from "@/components/Money";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
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
      <h1>Creator dashboard</h1>

      <section className="card">
        <h2>Earnings</h2>
        {earningsError !== null && <ErrorMessage error={earningsError} />}
        {earnings === null && earningsError === null && <Spinner label="Loading earnings…" />}
        {earnings !== null && (
          <>
            <p className="card-title">
              <Money value={earnings.totalEarnings} />
            </p>
            <p className="muted">
              {earnings.submissionCount} submission{earnings.submissionCount === 1 ? "" : "s"}
            </p>
            {earnings.byCampaign.length > 0 && (
              <ul className="breakdown">
                {earnings.byCampaign.map((row) => (
                  <li key={row.campaignId}>
                    {row.campaignName} — <Money value={row.paidAmount} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <CreatorCampaignList refreshToken={refreshToken} onRefresh={refreshAll} />

      {/* Slot: "My submissions" table (built next). */}
      <section>
        <h2>My submissions</h2>
        <p className="muted">Your submissions will appear here.</p>
      </section>
    </>
  );
}

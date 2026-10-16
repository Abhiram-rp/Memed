"use client";

/**
 * Brand dashboard (spec Phase 7): the brand's own campaigns, newest first, plus
 * a button that opens the dedicated create-campaign page. Each card expands to
 * load that campaign's submissions on demand.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import BrandCampaignCard from "@/components/BrandCampaignCard";
import CampaignCardSkeleton from "@/components/CampaignCardSkeleton";
import EmptyState from "@/components/EmptyState";
import ErrorMessage from "@/components/ErrorMessage";
import PageHeader from "@/components/PageHeader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { api } from "@/lib/api";
import type { Campaign } from "@/types/api";

export default function BrandDashboardPage() {
  return (
    <ProtectedRoute role="brand">
      <AppShell>
        <BrandDashboard />
      </AppShell>
    </ProtectedRoute>
  );
}

function BrandDashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setError(null);
      try {
        const result = await api.campaigns.mine();
        if (!cancelled) {
          setCampaigns(result.items);
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
  }, []);

  return (
    <>
      <PageHeader
        title="Your campaigns"
        subtitle="Fund attention. Pay for the views that land."
      />

      <div className="page-actions">
        <Link href="/brand/campaigns/new" className="btn">
          Create new campaign
        </Link>
      </div>

      <section>
        <h2>Campaigns</h2>

        {error !== null && <ErrorMessage error={error} />}
        {campaigns === null && error === null && (
          <>
            <p className="visually-hidden" role="status">
              Loading campaigns…
            </p>
            <CampaignCardSkeleton />
            <CampaignCardSkeleton />
          </>
        )}
        {campaigns !== null && campaigns.length === 0 && (
          <EmptyState
            title="No campaigns yet"
            description="Create your first campaign to start funding creators."
          />
        )}
        {campaigns !== null &&
          campaigns.map((campaign) => (
            <BrandCampaignCard key={campaign.id} campaign={campaign} />
          ))}
      </section>
    </>
  );
}

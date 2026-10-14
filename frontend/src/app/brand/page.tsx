"use client";

/**
 * Brand dashboard (spec Phase 7): the create-campaign form plus the brand's own
 * campaigns, newest first. Each card expands to load that campaign's
 * submissions on demand.
 */

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import BrandCampaignCard from "@/components/BrandCampaignCard";
import CampaignCardSkeleton from "@/components/CampaignCardSkeleton";
import CreateCampaignForm from "@/components/CreateCampaignForm";
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
  const [reloadToken, setReloadToken] = useState(0);

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
  }, [reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <>
      <PageHeader
        title="Your campaigns"
        subtitle="Fund attention. Pay for the views that land."
      />

      <CreateCampaignForm onCreated={reload} />

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
            description="Create your first campaign above to start funding creators."
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

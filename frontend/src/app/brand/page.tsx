"use client";

/**
 * Brand dashboard (spec Phase 7): the create-campaign form plus the brand's own
 * campaigns, newest first. Each card expands to load that campaign's
 * submissions on demand.
 */

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import BrandCampaignCard from "@/components/BrandCampaignCard";
import CreateCampaignForm from "@/components/CreateCampaignForm";
import ErrorMessage from "@/components/ErrorMessage";
import ProtectedRoute from "@/components/ProtectedRoute";
import Spinner from "@/components/Spinner";
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
      <h1>Your campaigns</h1>

      <CreateCampaignForm onCreated={reload} />

      <section>
        <h2>Campaigns</h2>

        {error !== null && <ErrorMessage error={error} />}
        {campaigns === null && error === null && <Spinner label="Loading campaigns…" />}
        {campaigns !== null && campaigns.length === 0 && (
          <p className="muted">No campaigns yet. Create your first one above.</p>
        )}
        {campaigns !== null &&
          campaigns.map((campaign) => (
            <BrandCampaignCard key={campaign.id} campaign={campaign} />
          ))}
      </section>
    </>
  );
}

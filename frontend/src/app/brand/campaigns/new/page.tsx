"use client";

/**
 * Dedicated create-campaign page (spec Phase 7). Reached from the "Create new
 * campaign" button on the brand dashboard. On a successful create the form
 * calls `onCreated`, which sends the brand back to their campaigns list.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import CreateCampaignForm from "@/components/CreateCampaignForm";
import PageHeader from "@/components/PageHeader";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function NewCampaignPage() {
  const router = useRouter();

  return (
    <ProtectedRoute role="brand">
      <AppShell>
        <PageHeader
          title="Create new campaign"
          subtitle="Set a budget and a milestone ladder, then fund creators."
        />

        <div className="page-actions">
          <Link href="/brand" className="btn secondary">
            Back to campaigns
          </Link>
        </div>

        <CreateCampaignForm onCreated={() => router.push("/brand")} />
      </AppShell>
    </ProtectedRoute>
  );
}

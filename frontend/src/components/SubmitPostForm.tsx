"use client";

/**
 * Submit-post form for one campaign card (spec Phase 7). Each instance owns its
 * own input/error state, so forms on different cards never share anything. The
 * server validates the URL against the campaign's platform and rejects
 * duplicates; those messages render under this form only.
 */

import { useState, type FormEvent } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import { api } from "@/lib/api";
import type { Campaign } from "@/types/api";

const PLACEHOLDER: Record<Campaign["platform"], string> = {
  instagram: "https://www.instagram.com/p/ABC123xyz",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

export default function SubmitPostForm({
  campaign,
  onSubmitted,
}: {
  campaign: Campaign;
  onSubmitted: () => void;
}) {
  const [postUrl, setPostUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmed = postUrl.trim();
    if (trimmed === "") {
      setClientError("Enter a post URL.");
      setSubmitted(false);
      return;
    }

    setClientError(null);
    setError(null);
    setSubmitted(false);
    setSubmitting(true);
    try {
      await api.submissions.create({ campaignId: campaign.id, postUrl: trimmed });
      setPostUrl("");
      setSubmitted(true);
      onSubmitted();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="submit-post-form" onSubmit={handleSubmit}>
      <div className="inline-field">
        <input
          type="text"
          value={postUrl}
          onChange={(event) => setPostUrl(event.target.value)}
          placeholder={PLACEHOLDER[campaign.platform]}
          aria-label={`Post URL for ${campaign.name}`}
          disabled={submitting}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>

      {clientError !== null && (
        <div className="error" role="alert">
          <p>{clientError}</p>
        </div>
      )}
      {error !== null && <ErrorMessage error={error} />}
      {submitted && <p className="success">Post submitted</p>}
    </form>
  );
}

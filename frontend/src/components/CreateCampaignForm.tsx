"use client";

/**
 * Create-campaign form (spec Phase 7). Client-side validation mirrors D8/D9 via
 * {@link validateCampaignForm}; server errors — including VALIDATION_ERROR
 * details such as `milestones.1.views` — are shown with {@link ErrorMessage}.
 */

import { useState } from "react";
import type { FormEvent } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import { api } from "@/lib/api";
import { MAX_MILESTONES, MIN_MILESTONES, validateCampaignForm } from "@/lib/campaignValidation";
import type { CampaignFormErrors, CampaignFormValues, MilestoneRow } from "@/lib/campaignValidation";

const EMPTY_ROW: MilestoneRow = { views: "", payout: "" };

function emptyForm(): CampaignFormValues {
  return { name: "", platform: "", budget: "", milestones: [{ ...EMPTY_ROW }] };
}

export default function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [values, setValues] = useState<CampaignFormValues>(emptyForm);
  const [errors, setErrors] = useState<CampaignFormErrors | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  function setField<K extends keyof CampaignFormValues>(
    key: K,
    value: CampaignFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateRow(index: number, patch: Partial<MilestoneRow>): void {
    setValues((current) => ({
      ...current,
      milestones: current.milestones.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function addRow(): void {
    setValues((current) =>
      current.milestones.length >= MAX_MILESTONES
        ? current
        : { ...current, milestones: [...current.milestones, { ...EMPTY_ROW }] },
    );
  }

  function removeRow(index: number): void {
    setValues((current) =>
      current.milestones.length <= MIN_MILESTONES
        ? current
        : { ...current, milestones: current.milestones.filter((_, i) => i !== index) },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitError(null);
    setSuccess(false);

    const result = validateCampaignForm(values);
    if (!result.valid || result.input === undefined) {
      setErrors(result.errors);
      return;
    }

    setErrors(null);
    setSubmitting(true);
    try {
      await api.campaigns.create(result.input);
      setValues(emptyForm());
      setSuccess(true);
      onCreated();
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} noValidate>
      <h2>Create a campaign</h2>

      <div className="field">
        <label htmlFor="campaign-name">Name</label>
        <input
          id="campaign-name"
          name="name"
          value={values.name}
          onChange={(event) => setField("name", event.target.value)}
        />
        {errors?.name !== undefined && <p className="error">{errors.name}</p>}
      </div>

      <div className="field">
        <label htmlFor="campaign-platform">Platform</label>
        <select
          id="campaign-platform"
          name="platform"
          value={values.platform}
          onChange={(event) =>
            setField("platform", event.target.value as CampaignFormValues["platform"])
          }
        >
          <option value="">Choose a platform</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        {errors?.platform !== undefined && <p className="error">{errors.platform}</p>}
      </div>

      <div className="field">
        <label htmlFor="campaign-budget">Budget (₹)</label>
        <input
          id="campaign-budget"
          name="budget"
          type="number"
          min={1}
          step={1}
          value={values.budget}
          onChange={(event) => setField("budget", event.target.value)}
        />
        {errors?.budget !== undefined && <p className="error">{errors.budget}</p>}
      </div>

      <fieldset>
        <legend>Milestones</legend>
        <p className="hint">
          Thresholds must be unique. Payouts must increase with views. Budget must cover at least
          the smallest payout.
        </p>
        {errors?.milestones !== undefined && <p className="error">{errors.milestones}</p>}

        {values.milestones.map((row, index) => (
          <div className="inline-field" key={index}>
            <div className="field">
              <label htmlFor={`views-${index}`}>Views</label>
              <input
                id={`views-${index}`}
                type="number"
                min={1}
                step={1}
                value={row.views}
                onChange={(event) => updateRow(index, { views: event.target.value })}
              />
              {errors?.rows[index]?.views !== undefined && (
                <p className="error">{errors.rows[index].views}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`payout-${index}`}>Payout (₹)</label>
              <input
                id={`payout-${index}`}
                type="number"
                min={1}
                step={1}
                value={row.payout}
                onChange={(event) => updateRow(index, { payout: event.target.value })}
              />
              {errors?.rows[index]?.payout !== undefined && (
                <p className="error">{errors.rows[index].payout}</p>
              )}
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => removeRow(index)}
              disabled={values.milestones.length <= MIN_MILESTONES}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          className="secondary"
          onClick={addRow}
          disabled={values.milestones.length >= MAX_MILESTONES}
        >
          Add milestone
        </button>
      </fieldset>

      {submitError !== null && <ErrorMessage error={submitError} />}
      {success && <p className="success">Campaign created</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create campaign"}
      </button>
    </form>
  );
}

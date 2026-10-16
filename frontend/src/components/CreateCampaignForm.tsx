"use client";

/**
 * Create-campaign form (spec Phase 7). Client-side validation mirrors D8/D9 via
 * {@link validateCampaignForm}; server errors — including VALIDATION_ERROR
 * details such as `milestones.1.views` — are shown with {@link ErrorMessage}.
 *
 * Layout: two columns on desktop, one on mobile. Milestone rows are tidy inline
 * rows, and a live preview of the ladder ("10K views → ₹500") updates as the
 * user types. The preview is display only — it never affects what is submitted.
 */

import { useState } from "react";
import type { FormEvent } from "react";
import ErrorMessage from "@/components/ErrorMessage";
import Money from "@/components/Money";
import { api } from "@/lib/api";
import { MAX_MILESTONES, MIN_MILESTONES, validateCampaignForm } from "@/lib/campaignValidation";
import type { CampaignFormErrors, CampaignFormValues, MilestoneRow } from "@/lib/campaignValidation";
import { formatCompactViews } from "@/lib/format";
import type { Milestone } from "@/types/api";

const EMPTY_ROW: MilestoneRow = { views: "", payout: "" };

/** ASCII digits only, matching the validation module's parsing. */
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

function emptyForm(): CampaignFormValues {
  return { name: "", platform: "", budget: "", milestones: [{ ...EMPTY_ROW }] };
}

function parsePositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Builds the display-only preview ladder from the rows that parse cleanly. */
function previewLadder(rows: MilestoneRow[]): Milestone[] {
  const parsed: Milestone[] = [];
  for (const row of rows) {
    const views = parsePositive(row.views);
    const payout = parsePositive(row.payout);
    if (views !== null && payout !== null) {
      parsed.push({ views, payout });
    }
  }
  return parsed.sort((a, b) => a.views - b.views);
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

  const preview = previewLadder(values.milestones);

  return (
    <form className="card create-campaign" onSubmit={handleSubmit} noValidate>
      <h2>Create a campaign</h2>

      <div className="form-grid">
        <div className="field form-grid-full">
          <label htmlFor="campaign-name">Name</label>
          <input
            id="campaign-name"
            name="name"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            aria-invalid={errors?.name !== undefined}
            aria-describedby={errors?.name !== undefined ? "campaign-name-error" : undefined}
          />
          {errors?.name !== undefined && (
            <p className="error" id="campaign-name-error">
              {errors.name}
            </p>
          )}
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
            aria-invalid={errors?.platform !== undefined}
            aria-describedby={errors?.platform !== undefined ? "campaign-platform-error" : undefined}
          >
            <option value="">Choose a platform</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
          {errors?.platform !== undefined && (
            <p className="error" id="campaign-platform-error">
              {errors.platform}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="campaign-budget">Budget (₹)</label>
          <input
            id="campaign-budget"
            name="budget"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={values.budget}
            onChange={(event) => setField("budget", event.target.value)}
            aria-invalid={errors?.budget !== undefined}
            aria-describedby={errors?.budget !== undefined ? "campaign-budget-error" : undefined}
          />
          {errors?.budget !== undefined && (
            <p className="error" id="campaign-budget-error">
              {errors.budget}
            </p>
          )}
        </div>
      </div>

      <fieldset className="milestones-fieldset">
        <legend>Milestones</legend>
        <p className="hint">
          Thresholds must be unique. Payouts must increase with views. Budget must cover at least
          the smallest payout.
        </p>
        {errors?.milestones !== undefined && <p className="error">{errors.milestones}</p>}

        <div className="milestone-rows">
          <div className="milestone-row milestone-row--head" aria-hidden="true">
            <span className="milestone-head">Views</span>
            <span className="milestone-head">Payout (₹)</span>
            <span />
          </div>

          {values.milestones.map((row, index) => (
            <div className="milestone-row" key={index}>
              <div className="milestone-cell">
                <span className="milestone-label" aria-hidden="true">
                  Views
                </span>
                <input
                  id={`views-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Milestone ${index + 1} views`}
                  value={row.views}
                  onChange={(event) => updateRow(index, { views: event.target.value })}
                  aria-invalid={errors?.rows[index]?.views !== undefined}
                  aria-describedby={
                    errors?.rows[index]?.views !== undefined ? `views-${index}-error` : undefined
                  }
                />
                {errors?.rows[index]?.views !== undefined && (
                  <p className="error" id={`views-${index}-error`}>
                    {errors.rows[index].views}
                  </p>
                )}
              </div>

              <div className="milestone-cell">
                <span className="milestone-label" aria-hidden="true">
                  Payout (₹)
                </span>
                <input
                  id={`payout-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  aria-label={`Milestone ${index + 1} payout in rupees`}
                  value={row.payout}
                  onChange={(event) => updateRow(index, { payout: event.target.value })}
                  aria-invalid={errors?.rows[index]?.payout !== undefined}
                  aria-describedby={
                    errors?.rows[index]?.payout !== undefined ? `payout-${index}-error` : undefined
                  }
                />
                {errors?.rows[index]?.payout !== undefined && (
                  <p className="error" id={`payout-${index}-error`}>
                    {errors.rows[index].payout}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="secondary milestone-remove"
                onClick={() => removeRow(index)}
                disabled={values.milestones.length <= MIN_MILESTONES}
                aria-label={`Remove milestone ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="secondary"
          onClick={addRow}
          disabled={values.milestones.length >= MAX_MILESTONES}
        >
          + Add milestone
        </button>
      </fieldset>

      <div className="ladder-preview">
        <h4>Ladder preview</h4>
        {preview.length === 0 ? (
          <p className="hint">Add a milestone to see the ladder.</p>
        ) : (
          <ul className="ladder-preview-list">
            {preview.map((milestone) => (
              <li className="ladder-preview-item" key={`${milestone.views}:${milestone.payout}`}>
                <span className="ladder-preview-views">
                  {formatCompactViews(milestone.views)} views
                </span>
                <span className="ladder-preview-arrow" aria-hidden="true">
                  →
                </span>
                <span className="ladder-preview-payout">
                  <Money value={milestone.payout} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {submitError !== null && <ErrorMessage error={submitError} />}
      {success && <p className="success">Campaign created</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create campaign"}
      </button>
    </form>
  );
}

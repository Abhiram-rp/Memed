/**
 * Budget usage bar. The percentage is clamped to 0-100 and a non-positive
 * `max` renders 0% rather than dividing by zero.
 *
 * Colour states are driven purely by percent used (display only):
 *   < 70%  -> accent (normal)
 *   70-89% -> amber
 *   >= 90% -> red
 *   = 100% -> red + a clear "Budget exhausted" state
 */
export default function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const rounded = Math.round(percent);
  const exhausted = rounded >= 100;

  let stateClass = "";
  if (exhausted) {
    stateClass = "is-exhausted";
  } else if (rounded >= 90) {
    stateClass = "is-danger";
  } else if (rounded >= 70) {
    stateClass = "is-warn";
  }

  return (
    <div className="progress-wrap">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded}% used`}
      >
        <div className={`progress-fill ${stateClass}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-label">
        <span className="muted">{rounded}% used</span>
        {exhausted && <span className="badge badge-red">Budget exhausted</span>}
      </p>
    </div>
  );
}

/**
 * Budget usage bar. The percentage is clamped to 0-100 and a non-positive
 * `max` renders 0% rather than dividing by zero.
 */
export default function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const rounded = Math.round(percent);

  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="hint">{rounded}% used</p>
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * Friendly placeholder for a list or panel with nothing to show yet: a short
 * title, an optional line of guidance and an optional action.
 */
export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true" />
      <p className="empty-state-title">{title}</p>
      {description !== undefined && <p className="empty-state-desc">{description}</p>}
      {action !== undefined && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

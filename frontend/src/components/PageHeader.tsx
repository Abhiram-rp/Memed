/**
 * Consistent page header used by both dashboards: a title plus a one-line
 * subtitle. Keeps the two dashboards visually aligned.
 */
export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {subtitle !== undefined && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}

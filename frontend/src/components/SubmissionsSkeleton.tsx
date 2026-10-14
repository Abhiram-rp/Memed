import Skeleton from "@/components/Skeleton";

/**
 * Placeholder rows that mirror a submissions table while it loads. It reuses
 * the real table classes, so it collapses into stacked cards on narrow screens
 * exactly like the loaded table does.
 */
export default function SubmissionsSkeleton({
  columns,
  rows = 3,
}: {
  columns: string[];
  rows?: number;
}) {
  return (
    <div className="table-wrap submissions-table-wrap" aria-hidden="true">
      <table className="submissions-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, columnIndex) => (
                <td key={column} data-label={column}>
                  <Skeleton width={columnIndex === 0 ? "90px" : "64px"} height="0.9rem" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

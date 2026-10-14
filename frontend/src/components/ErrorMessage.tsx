import { ApiError } from "@/lib/api";

/**
 * Renders a failed request. An {@link ApiError} shows its message plus any
 * field-level `path: message` details; anything else falls back to a generic
 * message. Renders nothing when there is no error.
 */
export default function ErrorMessage({ error }: { error: unknown }) {
  if (error === null || error === undefined) {
    return null;
  }

  if (error instanceof ApiError) {
    return (
      <div className="error" role="alert">
        <p>{error.message}</p>
        {error.details !== undefined && error.details.length > 0 && (
          <ul>
            {error.details.map((detail) => (
              <li key={`${detail.path}:${detail.message}`}>
                {detail.path}: {detail.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="error" role="alert">
      <p>Something went wrong</p>
    </div>
  );
}

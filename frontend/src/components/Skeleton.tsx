/**
 * Base loading placeholder: a shimmering block. Size it with `width`/`height`
 * (any CSS length) and optionally `radius`. It is decorative only, so it is
 * hidden from assistive technology — the surrounding region announces the
 * loading state with a visually-hidden status message.
 */
export default function Skeleton({
  width = "100%",
  height = "1rem",
  radius,
  className,
}: {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}) {
  return (
    <span
      className={className === undefined ? "skeleton" : `skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

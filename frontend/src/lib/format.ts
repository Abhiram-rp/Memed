/**
 * Formatting helpers. All money is integer rupees (D1) and is rendered with
 * en-IN grouping.
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-IN");

/** formatINR(5000) === "₹5,000" */
export function formatINR(n: number): string {
  return inrFormatter.format(n);
}

/** formatNumber(100000) === "1,00,000" */
export function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

/** Trims a trailing ".0" so 2.5 -> "2.5" but 1.0 -> "1". */
function trimDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/**
 * Compact view counts for previews and chips: 10000 -> "10K",
 * 250000 -> "2.5L", 12000000 -> "1.2Cr". Display only.
 */
export function formatCompactViews(n: number): string {
  if (n >= 10_000_000) {
    return `${trimDecimal(n / 10_000_000)}Cr`;
  }
  if (n >= 100_000) {
    return `${trimDecimal(n / 100_000)}L`;
  }
  if (n >= 1_000) {
    return `${trimDecimal(n / 1_000)}K`;
  }
  return String(n);
}

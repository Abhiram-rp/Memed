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

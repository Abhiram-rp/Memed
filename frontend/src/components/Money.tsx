import { formatINR } from "@/lib/format";

/** Renders an integer rupee amount with en-IN grouping (D1). */
export default function Money({ value }: { value: number }) {
  return <>{formatINR(value)}</>;
}

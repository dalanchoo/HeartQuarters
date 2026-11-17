import type { ReactNode } from 'react';

/** Longer fields can be folded up without hiding the comparison status. */
export function isLongComparisonField(label: string, ...values: (string | null | undefined)[]): boolean {
  return /^(description|tags|hashtags|pinned comment|comment|thumbnail idea|thumbnail prompt)$/i.test(label) || values.some(value => value?.includes('\n'));
}

export function ComparisonRow({ label, status, collapsible, children }: { label: string; status?: ReactNode; collapsible: boolean; children: ReactNode }) {
  const heading = <><strong>{label}</strong>{status}</>;
  return collapsible ? <details className="comparison-row" open><summary className="lvy-row-head">{heading}</summary>{children}</details> : <div className="comparison-row"><div className="lvy-row-head">{heading}</div>{children}</div>;
}

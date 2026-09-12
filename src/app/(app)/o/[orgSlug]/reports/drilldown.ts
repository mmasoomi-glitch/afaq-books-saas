export interface DrillDownTarget {
  readonly orgSlug: string;
  readonly accountId: string;
  /** Inclusive start, `YYYY-MM-DD`. Omitted for cumulative statements. */
  readonly from?: string;
  /** Inclusive end, `YYYY-MM-DD`. */
  readonly to?: string;
}

/**
 * The journal, filtered to one account over the same period the report covers.
 *
 * A plain module with no React import, so it can be unit-tested: there is no
 * jsdom environment in this project, so logic reachable only by rendering a
 * component is in practice untested. Same reason the app shell's nav table
 * lives in `nav.ts`.
 *
 * **A cumulative statement deliberately passes no `from`.** A trial balance or
 * balance sheet is everything up to a date; adding an arbitrary start would
 * show a subset that does NOT sum to the figure the reader clicked — which is
 * precisely the reconciliation this feature exists to provide. Only the profit
 * and loss, which is bounded at both ends, passes both.
 */
export function journalHref(target: DrillDownTarget): string {
  // The slug is a path segment, so URLSearchParams cannot encode it.
  const encodedSlug = encodeURIComponent(target.orgSlug);
  const params = new URLSearchParams();

  params.set("account", target.accountId);

  if (target.from !== undefined && target.from !== "") {
    params.set("from", target.from);
  }

  if (target.to !== undefined && target.to !== "") {
    params.set("to", target.to);
  }

  return `/o/${encodedSlug}/entries?${params.toString()}`;
}

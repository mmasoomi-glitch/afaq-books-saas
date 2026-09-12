/**
 * Shared navigation for the three statements.
 *
 * A server component with no state — it exists so the three report pages do not
 * each carry their own copy of the same link list, which is how one of them
 * ends up missing a link nobody notices.
 */
export interface ReportNavProps {
  readonly orgSlug: string;
}

export default function ReportNav({ orgSlug }: ReportNavProps) {
  return (
    <p>
      <a href={`/${orgSlug}/reports/trial-balance`}>Trial balance</a>
      {" · "}
      <a href={`/${orgSlug}/reports/profit-and-loss`}>Profit and loss</a>
      {" · "}
      <a href={`/${orgSlug}/reports/balance-sheet`}>Balance sheet</a>
      {" · "}
      <a href={`/${orgSlug}/entries`}>Journal</a>
      {" · "}
      <a href={`/${orgSlug}/periods`}>Periods</a>
      {" · "}
      <a href={`/${orgSlug}/accounts`}>Chart of accounts</a>
      {" · "}
      <a href={`/${orgSlug}/entries/new`}>New entry</a>
      {" · "}
      <a href={`/${orgSlug}/members`}>Members</a>
      {" · "}
      <a href="/organizations">All organizations</a>
    </p>
  );
}

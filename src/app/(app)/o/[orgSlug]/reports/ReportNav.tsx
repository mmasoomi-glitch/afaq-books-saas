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
      <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
      {" · "}
      <a href={`/o/${orgSlug}/reports/profit-and-loss`}>Profit and loss</a>
      {" · "}
      <a href={`/o/${orgSlug}/reports/balance-sheet`}>Balance sheet</a>
      {" · "}
      <a href={`/o/${orgSlug}/entries`}>Journal</a>
      {" · "}
      <a href={`/o/${orgSlug}/periods`}>Periods</a>
      {" · "}
      <a href={`/o/${orgSlug}/accounts`}>Chart of accounts</a>
      {" · "}
      <a href={`/o/${orgSlug}/entries/new`}>New entry</a>
      {" · "}
      <a href={`/o/${orgSlug}/audit`}>Audit trail</a>
      {" · "}
      <a href={`/o/${orgSlug}/members`}>Members</a>
      {" · "}
      <a href="/organizations">All organizations</a>
    </p>
  );
}

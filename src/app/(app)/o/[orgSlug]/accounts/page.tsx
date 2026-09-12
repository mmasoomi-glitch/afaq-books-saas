import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import { guardedListAccounts } from "../../../../../modules/ledger/guarded";
import { can } from "../../../../../server/auth/permissions";
import NewAccount from "./NewAccount";

export const metadata: Metadata = {
  title: "Chart of accounts · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

/** Assets, then liabilities, equity, income, expense — the order a reader expects. */
const TYPE_ORDER = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
] as const;

export default async function AccountsPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const accounts = await guardedListAccounts(scope);

  const ordered = [...accounts].sort((a, b) => {
    const byType =
      TYPE_ORDER.indexOf(a.type as (typeof TYPE_ORDER)[number]) -
      TYPE_ORDER.indexOf(b.type as (typeof TYPE_ORDER)[number]);
    return byType !== 0 ? byType : a.code.localeCompare(b.code);
  });

  return (
    <main>
      <h1>Chart of accounts</h1>
      <p>
        {scope.organizationSlug} ·{" "}
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
        <a href={`/o/${orgSlug}/entries/new`}>New journal entry</a>
        {" · "}
        <a href={`/o/${orgSlug}/members`}>Members</a>
      </p>

      {ordered.length === 0 ? (
        // Truthful empty state. A new organization has no accounts, and a chart
        // padded with a "standard" set nobody chose would be an accounting
        // decision made on the user's behalf and attributed to them.
        <p>
          No accounts yet. Every journal entry names accounts, so the chart has
          to come first.
        </p>
      ) : (
        <table>
          <caption>
            Every account in this organization&rsquo;s chart, grouped by type.
          </caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Currency</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((account) => (
              <tr key={account.id}>
                <td>{account.code}</td>
                <td>{account.name}</td>
                <td>{account.type}</td>
                <td>{account.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {can(scope.role, "ledger.account.create") ? (
        <NewAccount orgSlug={orgSlug} />
      ) : (
        <p>
          Your role can read the chart but not add to it. A bookkeeper or above
          can.
        </p>
      )}
    </main>
  );
}

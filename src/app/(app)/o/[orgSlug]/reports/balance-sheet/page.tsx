import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedBalanceSheet } from "../../../../../../modules/reports/guarded";
import type { BalanceSheetRow } from "../../../../../../modules/reports/balance-sheet";
import AsOfForm from "../AsOfForm";

export const metadata: Metadata = {
  title: "Balance sheet · Afaq Books",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parseAsOf(raw: string | string[] | undefined): Date {
  if (typeof raw !== "string") return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function Section({
  title,
  rows,
  total,
}: {
  readonly title: string;
  readonly rows: readonly BalanceSheetRow[];
  readonly total: string;
}) {
  return (
    <table>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Code</th>
          <th scope="col">Account</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={3}>None</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.accountId}>
              <td>{row.accountCode}</td>
              <td>{row.accountName}</td>
              <td>{row.amount}</td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={2}>
            Total {title.toLowerCase()}
          </th>
          <td>{total}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default async function BalanceSheetPage({
  params,
  searchParams,
}: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const asOf = parseAsOf((await searchParams)["asOf"]);

  // `balanceSheet` enforces assets = liabilities + equity + retained earnings
  // at exact Decimal equality and refuses to return a result that fails it. So
  // by the time this renders, the identity has already been checked against the
  // ledger — this page never has to assert it, and must not pretend to.
  const report = await guardedBalanceSheet(scope, asOf);

  return (
    <main>
      <h1>Balance sheet</h1>
      <p>
        {scope.organizationSlug} · as at{" "}
        <time dateTime={report.asOf}>{report.asOf}</time>
      </p>

      <AsOfForm asOf={report.asOf} />

      <Section title="Assets" rows={report.assets} total={report.totalAssets} />
      <Section
        title="Liabilities"
        rows={report.liabilities}
        total={report.totalLiabilities}
      />
      <Section title="Equity" rows={report.equity} total={report.totalEquity} />

      <p>
        Retained earnings: <strong>{report.retainedEarnings}</strong>
      </p>
      <p>
        {/*
          Stated, not computed. The service refuses to return a balance sheet
          that does not satisfy this identity at exact Decimal equality, so
          recomputing it here could only ever produce a second opinion — and
          I4 is explicit that a report must derive from the ledger rather than
          from anything assembled in the UI.
        */}
        Assets equal liabilities plus equity plus retained earnings. The report
        is refused outright if they do not, so seeing this page at all means the
        identity held against the posted ledger.
      </p>

      <p>
        Posted entries only, cumulative to the date shown, in the
        organization&rsquo;s reporting currency.
      </p>
    </main>
  );
}

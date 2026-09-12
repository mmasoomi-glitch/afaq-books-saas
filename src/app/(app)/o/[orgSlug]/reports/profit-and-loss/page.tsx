import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedProfitAndLoss } from "../../../../../../modules/reports/guarded";
import DateRangeForm from "../DateRangeForm";
import AccountLink from "../AccountLink";

export const metadata: Metadata = {
  title: "Profit and loss · Afaq Books",
  robots: { index: false, follow: false },
};

/** Never cached. Every figure is one organization's financial position. */
export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A date from the query string, or a fallback.
 *
 * An unparseable value falls back rather than throwing — it arrives from a link
 * someone may have edited, and a malformed one is not an attack. What it must
 * never become is `Invalid Date`, which SQL compares against nothing and which
 * would produce an empty report: a business that looks like it earned nothing.
 */
function parseDate(raw: string | string[] | undefined, fallback: Date): Date {
  if (typeof raw !== "string") return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export default async function ProfitAndLossPage({
  params,
  searchParams,
}: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const query = await searchParams;

  const now = new Date();
  const from = parseDate(query["from"], new Date(now.getFullYear(), 0, 1));
  const to = parseDate(query["to"], now);

  // The service refuses an inverted range rather than silently returning
  // nothing, so this catches it and says what to do instead of surfacing a
  // stack trace through the error boundary.
  if (from > to) {
    return (
      <main>
        <h1>Profit and loss</h1>
        <p role="alert">
          The start date is after the end date. Adjust the range and try again.
        </p>
        <DateRangeForm
          from={from.toISOString().slice(0, 10)}
          to={to.toISOString().slice(0, 10)}
        />
      </main>
    );
  }

  const report = await guardedProfitAndLoss(scope, from, to);

  return (
    <main>
      <h1>Profit and loss</h1>
      <p>
        {scope.organizationSlug} ·{" "}
        <time dateTime={report.from}>{report.from}</time> to{" "}
        <time dateTime={report.to}>{report.to}</time>
      </p>

      <DateRangeForm from={report.from} to={report.to} />

      {report.income.length === 0 && report.expenses.length === 0 ? (
        <p>No posted income or expense entries in this range.</p>
      ) : (
        <>
          <table>
            <caption>Income</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Account</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.income.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <AccountLink
                      orgSlug={orgSlug}
                      accountId={row.accountId}
                      accountCode={row.accountCode}
                      accountName={row.accountName}
                      from={from.toISOString().slice(0, 10)}
                      to={to.toISOString().slice(0, 10)}
                    />
                  </td>
                  <td>{row.accountName}</td>
                  <td>{row.amount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total income
                </th>
                <td>{report.totalIncome}</td>
              </tr>
            </tfoot>
          </table>

          <table>
            <caption>Expenses</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Account</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <AccountLink
                      orgSlug={orgSlug}
                      accountId={row.accountId}
                      accountCode={row.accountCode}
                      accountName={row.accountName}
                      from={from.toISOString().slice(0, 10)}
                      to={to.toISOString().slice(0, 10)}
                    />
                  </td>
                  <td>{row.accountName}</td>
                  <td>{row.amount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total expenses
                </th>
                <td>{report.totalExpenses}</td>
              </tr>
            </tfoot>
          </table>

          <p>
            {/*
              From the report, never recomputed here. Subtracting the two totals
              in this component would produce a number that agrees with what is
              displayed even when it disagrees with the ledger — the failure I4
              forbids by name.
            */}
            <strong>Net profit: {report.netProfit}</strong>
          </p>
        </>
      )}

      <p>
        Posted entries only, in the organization&rsquo;s reporting currency, to
        four decimal places. A
        reversal appears as its own opposite amounts rather than removing the
        original, so a reversed transaction nets to zero here rather than
        vanishing.
      </p>
    </main>
  );
}

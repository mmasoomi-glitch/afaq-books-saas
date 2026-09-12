import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedTrialBalance } from "../../../../../../modules/reports/guarded";
import AsOfForm from "../AsOfForm";
import AccountLink from "../AccountLink";

export const metadata: Metadata = {
  title: "Trial balance · Nagdengi",
  robots: { index: false, follow: false },
};

/**
 * Never cached, never statically rendered.
 *
 * Every word on this page is one organization's financial position. A cached
 * copy served to the next visitor would be a cross-tenant disclosure, and it
 * would happen without anyone attacking anything.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  // Route params are a Promise in Next 15.
  readonly params: Promise<{ orgSlug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `asOf` from the query string, or today.
 *
 * An unparseable date falls back to today rather than throwing. The value is
 * user-controlled and arrives from a link someone may have edited or mangled;
 * a malformed one is not an attack and should not be an error page. What it
 * must NOT do is silently become `Invalid Date`, which SQL would compare
 * against nothing and quietly return an empty report — a balance sheet of
 * zeros that looks like a company with no transactions.
 */
function parseAsOf(raw: string | string[] | undefined): Date {
  if (typeof raw !== "string") return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default async function TrialBalancePage({
  params,
  searchParams,
}: PageProps) {
  const { orgSlug } = await params;

  // The whole authorization chain, in one call: session → membership →
  // permission. A visitor with no session is redirected to sign in; one who is
  // not a member of this organization gets a 404 that is indistinguishable
  // from the organization not existing.
  const scope = await cachedPageScope(orgSlug);

  const asOf = parseAsOf((await searchParams)["asOf"]);

  // `guardedTrialBalance` asserts `report.read` before it reads anything, and
  // the figures come from posted ledger rows summed in SQL — never from a
  // cached aggregate and never from anything computed in this component.
  // `trialBalance` itself refuses to return an unbalanced result at all.
  const report = await guardedTrialBalance(scope, asOf);

  return (
    <main>
      <h1>Trial balance</h1>
      <p>
        {scope.organizationSlug} · as at{" "}
        <time dateTime={report.asOf}>{report.asOf.slice(0, 10)}</time>
      </p>
      <AsOfForm asOf={report.asOf} />

      {report.rows.length === 0 ? (
        // A truthful empty state. `.claude/rules/no-mocks-no-stubs.md` forbids
        // padding this with example rows: an organization with no postings has
        // no trial balance, and saying so is the correct answer.
        <p>No posted journal entries as at this date.</p>
      ) : (
        <table>
          <caption>
            Debits and credits by account, from posted entries only.
          </caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Account</th>
              <th scope="col">Debit</th>
              <th scope="col">Credit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId}>
                <td>
                  {/*
                    No `from`. A trial balance is everything up to a date, so a
                    start date would open a journal showing a subset that does
                    not sum to the figure just clicked — the opposite of what a
                    drill-down is for.
                  */}
                  <AccountLink
                    orgSlug={orgSlug}
                    accountId={row.accountId}
                    accountCode={row.accountCode}
                    accountName={row.accountName}
                    to={report.asOf.slice(0, 10)}
                  />
                </td>
                <td>{row.accountName}</td>
                <td>{row.debit}</td>
                <td>{row.credit}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {/*
                The totals come from the report, not from summing the rows in
                this component. Adding them up here would produce a number that
                agrees with what is displayed even when it disagrees with the
                ledger — which is exactly the failure the accounting rules
                forbid: a report derived from the UI rather than from the data.
              */}
              <th scope="row" colSpan={2}>
                Total
              </th>
              <td>{report.totalDebit}</td>
              <td>{report.totalCredit}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <p>
        Amounts are in the organization&rsquo;s reporting currency, to four
        decimal places.
      </p>
    </main>
  );
}

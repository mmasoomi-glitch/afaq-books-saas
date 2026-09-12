import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import { guardedListPeriods } from "../../../../../modules/ledger/guarded";
import { can } from "../../../../../server/auth/permissions";
import PeriodAdmin from "./PeriodAdmin";

export const metadata: Metadata = {
  title: "Accounting periods · Afaq Books",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function PeriodsPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const periods = await guardedListPeriods(scope);

  const today = new Date();
  const covered = periods.some(
    (period) =>
      period.status === "OPEN" &&
      period.startDate <= today &&
      period.endDate >= today,
  );

  return (
    <main>
      <h1>Accounting periods</h1>
      <p>
        {scope.organizationSlug} ·{" "}
        <a href={`/o/${orgSlug}/entries`}>Journal</a>
        {" · "}
        <a href={`/o/${orgSlug}/accounts`}>Chart of accounts</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/profit-and-loss`}>Profit and loss</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/balance-sheet`}>Balance sheet</a>
      </p>

      {!covered ? (
        // Named specifically, because this is the condition that silently
        // blocks posting AND reversal. A reversal defaults to today, so with no
        // open period covering today a user can post nothing and correct
        // nothing — and the refusal arrives at the moment they are trying to
        // work, not here.
        <p role="alert">
          No open period covers today ({iso(today)}). Until one does, you cannot
          post an entry dated today or reverse an existing one.
        </p>
      ) : null}

      {periods.length === 0 ? (
        <p>No periods yet. Every journal entry belongs to one.</p>
      ) : (
        <table>
          <caption>
            Periods, newest first. <strong>Open</strong> accepts postings;{" "}
            <strong>closed</strong> refuses normal postings;{" "}
            <strong>locked</strong> refuses everything until an administrator
            unlocks it, and the unlock is recorded.
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.id}>
                <td>{period.name}</td>
                <td>
                  <time dateTime={iso(period.startDate)}>
                    {iso(period.startDate)}
                  </time>
                </td>
                <td>
                  <time dateTime={iso(period.endDate)}>
                    {iso(period.endDate)}
                  </time>
                </td>
                <td>{period.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {can(scope.role, "ledger.period.create") ? (
        <PeriodAdmin
          orgSlug={orgSlug}
          periods={periods.map((period) => ({
            id: period.id,
            name: period.name,
            status: period.status,
          }))}
          canClose={can(scope.role, "ledger.period.close")}
          canLock={can(scope.role, "ledger.period.lock")}
          canUnlock={can(scope.role, "ledger.period.unlock")}
        />
      ) : (
        <p>
          Your role can read periods but not create or change them. A bookkeeper
          can create one; closing needs an accountant, and locking an
          administrator.
        </p>
      )}
    </main>
  );
}

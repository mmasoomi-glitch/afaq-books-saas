import type { Metadata } from "next";
import { requirePageScope } from "../../../../../../server/next/page-scope";
import {
  guardedListAccounts,
  guardedListPeriods,
} from "../../../../../../modules/ledger/guarded";
import { can } from "../../../../../../server/auth/permissions";
import EntryForm from "./EntryForm";

export const metadata: Metadata = {
  title: "New journal entry · Afaq Books",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function NewEntryPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await requirePageScope(orgSlug);

  if (!can(scope.role, "ledger.post")) {
    // Refused before anything is loaded. The endpoint refuses too — this is
    // about not rendering a form whose only possible outcome is a 403.
    return (
      <main>
        <h1>New journal entry</h1>
        <p role="alert">
          Your role cannot post entries. A bookkeeper or above can.
        </p>
        <p>
          <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
        </p>
      </main>
    );
  }

  const [accounts, periods] = await Promise.all([
    guardedListAccounts(scope),
    guardedListPeriods(scope),
  ]);

  const open = periods.filter((period) => period.status === "OPEN");

  return (
    <main>
      <h1>New journal entry</h1>
      <p>
        {scope.organizationSlug} ·{" "}
        <a href={`/o/${orgSlug}/accounts`}>Chart of accounts</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
      </p>

      {accounts.length < 2 || open.length === 0 ? (
        // Truthful blocked state, naming BOTH prerequisites rather than
        // rendering a form that cannot be completed. An entry needs at least
        // two accounts to have two sides, and an open period to post into.
        <>
          <p role="alert">You cannot post an entry yet.</p>
          <ul>
            {accounts.length < 2 ? (
              <li>
                An entry needs at least two accounts — one to debit and one to
                credit. You have {accounts.length}.{" "}
                <a href={`/o/${orgSlug}/accounts`}>Add accounts</a>.
              </li>
            ) : null}
            {open.length === 0 ? (
              <li>
                There is no open accounting period to post into.
                {periods.length > 0
                  ? " Every period you have is closed or locked."
                  : " No periods have been created."}{" "}
                <a href={`/o/${orgSlug}/periods`}>Open a period</a>.
              </li>
            ) : null}
          </ul>
        </>
      ) : (
        <EntryForm
          orgSlug={orgSlug}
          accounts={accounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            currency: a.currency,
          }))}
          periods={open.map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
    </main>
  );
}

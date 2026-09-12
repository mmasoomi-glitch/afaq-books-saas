import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import { guardedListEntries } from "../../../../../modules/ledger/guarded";
import { can } from "../../../../../server/auth/permissions";
import ReverseButton from "./ReverseButton";

export const metadata: Metadata = {
  title: "Journal · Afaq Books",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function EntriesPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const entries = await guardedListEntries(scope);

  const canReverse = can(scope.role, "ledger.reverse");

  return (
    <main>
      <h1>Journal</h1>
      <p>
        {scope.organizationSlug} ·{" "}
        <a href={`/o/${orgSlug}/entries/new`}>New journal entry</a>
        {" · "}
        <a href={`/o/${orgSlug}/accounts`}>Chart of accounts</a>
        {" · "}
        <a href={`/o/${orgSlug}/periods`}>Periods</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/trial-balance`}>Trial balance</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/profit-and-loss`}>Profit and loss</a>
        {" · "}
        <a href={`/o/${orgSlug}/reports/balance-sheet`}>Balance sheet</a>
      </p>

      {entries.length === 0 ? (
        <p>
          Nothing posted yet. <a href={`/o/${orgSlug}/entries/new`}>Post an entry</a>
          .
        </p>
      ) : (
        <>
          <p>
            The {entries.length} most recent posted entries, newest first.
            Posted entries cannot be edited or deleted — a correction is a
            reversal, and both stay in the record.
          </p>

          {entries.map((entry) => (
            <section key={entry.id}>
              <h2>
                #{entry.journalNumber ?? "—"} · {entry.description}
              </h2>
              <p>
                <time dateTime={entry.entryDate.toISOString()}>
                  {entry.entryDate.toISOString().slice(0, 10)}
                </time>{" "}
                · {entry.currency}
                {entry.reversalOfId !== null ? (
                  // Stated on the entry itself. A reversal that looked like an
                  // ordinary entry would make the journal read as if the same
                  // transaction happened twice in opposite directions for no
                  // reason.
                  <> · reverses an earlier entry</>
                ) : null}
                {entry.reversedById !== null ? (
                  <> · has been reversed</>
                ) : null}
              </p>

              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Debit</th>
                    <th scope="col">Credit</th>
                    <th scope="col">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line, index) => (
                    <tr key={`${entry.id}-${String(index)}`}>
                      <td>
                        {line.accountCode} — {line.accountName}
                      </td>
                      <td>{line.debit}</td>
                      <td>{line.credit}</td>
                      <td>{line.memo ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {canReverse && entry.reversedById === null ? (
                <ReverseButton
                  orgSlug={orgSlug}
                  entryId={entry.id}
                  journalNumber={entry.journalNumber}
                />
              ) : null}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

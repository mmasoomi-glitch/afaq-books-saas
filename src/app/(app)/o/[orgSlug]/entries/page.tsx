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
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

export default async function EntriesPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);

  // The cursor is user-controlled and is handed straight back to the service,
  // which resolves it INSIDE this organization. An id belonging to another
  // tenant, an id that no longer exists and a mangled string are all answered
  // the same way — page one — so the parameter cannot be used to ask whether
  // somebody else's entry exists.
  const cursor = single((await searchParams)["cursor"]);
  const page = await guardedListEntries(
    scope,
    cursor === undefined ? {} : { cursor },
  );
  const entries = page.entries;
  const paging = cursor !== undefined || page.nextCursor !== null;

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
        cursor === undefined ? (
          <p>
            Nothing posted yet.{" "}
            <a href={`/o/${orgSlug}/entries/new`}>Post an entry</a>.
          </p>
        ) : (
          // Reachable: a cursor that has stopped being valid — the entry it
          // named was the last one, or the link is old. Saying "nothing posted
          // yet" here would be false, and this organization plainly has
          // entries or there would have been no cursor to follow.
          <p>
            No further entries.{" "}
            <a href={`/o/${orgSlug}/entries`}>Back to the most recent</a>.
          </p>
        )
      ) : (
        <>
          <p>
            {paging
              ? `${String(entries.length)} entries, newest first.`
              : `All ${String(entries.length)} posted entries, newest first.`}{" "}
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

          {/*
            Forward paging only, and the limitation is stated rather than
            hidden. A cursor identifies where the NEXT page starts; walking
            backwards needs the ordering reversed, which is a different query.
            "Most recent" returns to the start, which is the only backwards
            move available and is the one people actually want.
          */}
          <nav aria-label="Journal pages">
            <p>
              {cursor === undefined ? null : (
                <>
                  <a href={`/o/${orgSlug}/entries`}>Most recent entries</a>
                  {page.nextCursor === null ? null : " · "}
                </>
              )}
              {page.nextCursor === null ? (
                cursor === undefined ? null : (
                  <> · This is the end of the journal.</>
                )
              ) : (
                <a
                  href={`/o/${orgSlug}/entries?cursor=${encodeURIComponent(
                    page.nextCursor,
                  )}`}
                >
                  Older entries
                </a>
              )}
            </p>
          </nav>
        </>
      )}
    </main>
  );
}

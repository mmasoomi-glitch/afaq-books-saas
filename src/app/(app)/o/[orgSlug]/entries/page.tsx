import type { Metadata } from "next";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import {
  guardedListAccounts,
  guardedListEntries,
} from "../../../../../modules/ledger/guarded";
import JournalFilterForm from "./JournalFilterForm";
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

/**
 * A date from the query string, or nothing.
 *
 * An unparseable value is dropped rather than thrown, for the same reason the
 * reports do it: the value arrives from a link someone may have edited, and a
 * mangled link is not an error page. What it must not become is `Invalid Date`,
 * which SQL compares against nothing and silently returns an empty journal —
 * which reads as "you have posted nothing".
 */
function parseDate(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function EntriesPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);

  // The cursor is user-controlled and is handed straight back to the service,
  // which resolves it INSIDE this organization. An id belonging to another
  // tenant, an id that no longer exists and a mangled string are all answered
  // the same way — page one — so the parameter cannot be used to ask whether
  // somebody else's entry exists.
  const query = await searchParams;
  const cursor = single(query["cursor"]);

  // `size` is clamped to 1…MAX_JOURNAL_PAGE by the service, which is where the
  // rule belongs — the query string is not the only caller. Parsing it here
  // rather than passing the raw string keeps `NaN` out of the service, where it
  // would be indistinguishable from "not specified".
  const rawSize = single(query["size"]);
  const size = rawSize === undefined ? undefined : Number.parseInt(rawSize, 10);

  const accountId = single(query["account"]);
  const from = parseDate(single(query["from"]));
  const to = parseDate(single(query["to"]));
  const filter = {
    ...(accountId === undefined ? {} : { accountId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
  const filtered = Object.keys(filter).length > 0;

  // Only fetched when there is a filter form to populate, which there always
  // is — but reading the chart of accounts needs the same permission the
  // journal does, so this cannot widen who sees what.
  const accounts = await guardedListAccounts(scope);

  /**
   * The current filter as query parameters, for the paging links.
   *
   * The cursor is deliberately NOT included: these build links, and the cursor
   * is added by the caller that wants one. The filter FORM leaves it out too,
   * which is the important half — submitting a new filter with the old cursor
   * still attached would ask for "page two of a query that no longer exists".
   * The service fingerprints the filter into the cursor and would serve page
   * one anyway, so this is the second of two independent defences rather than
   * the only one.
   */
  const filterParams = (): URLSearchParams => {
    const out = new URLSearchParams();
    if (accountId !== undefined) out.set("account", accountId);
    if (from !== undefined) out.set("from", isoDay(from));
    if (to !== undefined) out.set("to", isoDay(to));
    if (size !== undefined && !Number.isNaN(size)) {
      out.set("size", String(size));
    }
    return out;
  };

  const linkTo = (cursorValue?: string): string => {
    const out = filterParams();
    if (cursorValue !== undefined) out.set("cursor", cursorValue);
    const query = out.toString();
    return `/o/${orgSlug}/entries${query === "" ? "" : `?${query}`}`;
  };

  const page = await guardedListEntries(scope, {
    ...(cursor === undefined ? {} : { cursor }),
    ...(size === undefined || Number.isNaN(size) ? {} : { pageSize: size }),
    ...(filtered ? { filter } : {}),
  });
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

      <JournalFilterForm
        orgSlug={orgSlug}
        accounts={accounts.map((account) => ({
          id: account.id,
          code: account.code,
          name: account.name,
        }))}
        accountId={accountId ?? ""}
        from={from === undefined ? "" : isoDay(from)}
        to={to === undefined ? "" : isoDay(to)}
        size={size === undefined || Number.isNaN(size) ? "" : String(size)}
      />

      {page.accountTotals === null ? (
        // An account was named and is not in this organization. Saying "no
        // entries" would be true and misleading: it reads as "this account has
        // no postings" rather than "there is no such account here".
        <p role="alert">
          No such account in this organization.{" "}
          <a href={`/o/${orgSlug}/entries`}>Show the whole journal</a>.
        </p>
      ) : null}

      {page.accountTotals === null || page.accountTotals === undefined ? null : (
        <p>
          <strong>
            {page.accountTotals.accountCode} — {page.accountTotals.accountName}
          </strong>
          : debits {page.accountTotals.debit}, credits{" "}
          {page.accountTotals.credit} across every entry matching this filter —
          not only the ones on this page. These are the figures a trial balance
          for the same range is built from.
        </p>
      )}

      {entries.length === 0 ? (
        page.accountTotals === null ? null : filtered ? (
          <p>
            No posted entries match this filter.{" "}
            <a href={`/o/${orgSlug}/entries`}>Clear it</a>.
          </p>
        ) : cursor === undefined ? (
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
            {paging || filtered
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
                  <a href={linkTo()}>Most recent entries</a>
                  {page.nextCursor === null ? null : " · "}
                </>
              )}
              {page.nextCursor === null ? (
                cursor === undefined ? null : (
                  <> · This is the end of the journal.</>
                )
              ) : (
                <a href={linkTo(page.nextCursor)}>Older entries</a>
              )}
            </p>
          </nav>
        </>
      )}
    </main>
  );
}

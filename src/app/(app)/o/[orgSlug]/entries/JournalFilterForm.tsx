export interface FilterAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface JournalFilterFormProps {
  readonly orgSlug: string;
  readonly accounts: readonly FilterAccount[];
  readonly accountId: string;
  readonly from: string;
  readonly to: string;
  readonly size: string;
}

/**
 * Filter the journal.
 *
 * A `GET` form with no JavaScript, deliberately. The result is a URL, which
 * means a filtered journal can be bookmarked, shared with the colleague who
 * asked the question, or pasted into a working paper — and the back button
 * behaves the way it should. A client-side filter would give none of that and
 * would need the state kept somewhere it could disagree with what is displayed.
 *
 * **There is no hidden `cursor` field, and that is the point.** Submitting a
 * new filter while carrying the old cursor asks for "page two of a query that
 * no longer exists": the cursor names a row that may not be in the new result
 * set, so the answer would start at an arbitrary point with the rows before it
 * silently missing. Leaving the field out drops the cursor on every submit.
 *
 * The service also fingerprints the filter into the cursor and serves page one
 * on a mismatch, so this is the second of two independent defences. Either
 * alone would be enough; the reason for both is that this one is easy to break
 * by adding a field, and that one is easy to break by changing a hash.
 */
export default function JournalFilterForm({
  orgSlug,
  accounts,
  accountId,
  from,
  to,
  size,
}: JournalFilterFormProps) {
  return (
    <form method="get" action={`/o/${orgSlug}/entries`}>
      <fieldset>
        <legend>Filter</legend>

        <label htmlFor="filter-account">Account</label>
        <select id="filter-account" name="account" defaultValue={accountId}>
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} — {account.name}
            </option>
          ))}
        </select>

        <label htmlFor="filter-from">From</label>
        <input id="filter-from" type="date" name="from" defaultValue={from} />

        <label htmlFor="filter-to">To</label>
        <input id="filter-to" type="date" name="to" defaultValue={to} />

        <label htmlFor="filter-size">Per page</label>
        <input
          id="filter-size"
          type="number"
          name="size"
          min="1"
          max="100"
          defaultValue={size}
        />

        <button type="submit">Apply</button>
        {/*
          A link rather than a reset button: reset restores the form's initial
          values, which are the CURRENT filter, so it would appear to do
          nothing. Clearing means going to the unfiltered URL.
        */}
        <a href={`/o/${orgSlug}/entries`}>Clear</a>
      </fieldset>

      <p>
        Dates are inclusive and match the entry date, not the date it was
        posted. Filtering by account shows each matching entry in full,
        including its other side.
      </p>
    </form>
  );
}

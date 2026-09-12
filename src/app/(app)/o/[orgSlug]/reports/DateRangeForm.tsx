/**
 * A plain GET form. No JavaScript, no client component, no fetch.
 *
 * Submitting it navigates with `?from=…&to=…`, which the page already reads —
 * so the report is a URL. That means it can be bookmarked, shared with an
 * accountant, and opened again next quarter, and it means the back button does
 * what a person expects. A client-side date picker would have cost all three.
 */
export interface DateRangeFormProps {
  readonly from: string;
  readonly to: string;
}

export default function DateRangeForm({ from, to }: DateRangeFormProps) {
  return (
    <form method="get">
      <label htmlFor="range-from">From</label>
      <input id="range-from" type="date" name="from" defaultValue={from} />
      <label htmlFor="range-to">To</label>
      <input id="range-to" type="date" name="to" defaultValue={to} />
      <button type="submit">Show</button>
    </form>
  );
}

/** A plain GET form, for the reports that take a single date. See DateRangeForm. */
export interface AsOfFormProps {
  readonly asOf: string;
}

export default function AsOfForm({ asOf }: AsOfFormProps) {
  return (
    <form method="get">
      <label htmlFor="as-of">As at</label>
      <input id="as-of" type="date" name="asOf" defaultValue={asOf} />
      <button type="submit">Show</button>
    </form>
  );
}

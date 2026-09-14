import type { Metadata } from "next";
import type { CreditNoteSummary } from "../../../../../../modules/sales/credit-notes";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedListCreditNotes } from "../../../../../../modules/sales/guarded";

export const metadata: Metadata = {
  title: "Credit notes · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function CreditNotesPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const notes = await guardedListCreditNotes(scope);

  return (
    <main>
      <h1>Credit notes</h1>
      <p>
        <a href={`/o/${orgSlug}/accounts`}>Chart of accounts</a>
        {" · "}
        <a href={`/o/${orgSlug}/entries`}>Journal</a>
        {" · "}
        <a href={`/o/${orgSlug}/sales/customers`}>Customers</a>
        {" · "}
        <a href={`/o/${orgSlug}/sales/invoices`}>Invoices</a>
        {" · "}
        <a href={`/o/${orgSlug}/sales/payments`}>Payments</a>
        {" · "}
        <a href={`/o/${orgSlug}/sales/credit-notes`}>Credit notes</a>
        {" · "}
        <a href={`/o/${orgSlug}/sales/ar-aging`}>AR aging</a>
      </p>

      {notes.length === 0 ? (
        <p>No credit notes recorded yet.</p>
      ) : (
        <table>
          <caption>
            {notes.length} credit note{notes.length !== 1 ? "s" : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Customer</th>
              <th scope="col">Date</th>
              <th scope="col">Amount</th>
              <th scope="col">Remaining</th>
              <th scope="col">Reason</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n: CreditNoteSummary) => (
              <tr key={n.id}>
                <td>{n.creditNoteNumber ?? "—"}</td>
                <td>{(n as unknown as { customerName?: string }).customerName ?? "—"}</td>
                <td>{n.issueDate.toISOString().slice(0, 10)}</td>
                <td>{Number(n.totalAmount).toFixed(2)}</td>
                <td>{Number(n.remainingAmount).toFixed(2)}</td>
                <td>{n.reason ?? "—"}</td>
                <td>{n.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

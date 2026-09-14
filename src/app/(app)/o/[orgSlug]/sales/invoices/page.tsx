import type { Metadata } from "next";
import type { InvoiceSummary } from "../../../../../../modules/sales/invoices";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedListInvoices } from "../../../../../../modules/sales/guarded";
import NewInvoice from "./NewInvoice";

export const metadata: Metadata = {
  title: "Invoices · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

const STATUS_ORDER = [
  "DRAFT",
  "ISSUED",
  "PARTIAL",
  "PAID",
  "CANCELLED",
  "VOID",
] as const;

type StatusKey = (typeof STATUS_ORDER)[number];

export default async function InvoicesPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const invoices = await guardedListInvoices(scope);

  const ordered = [...invoices].sort((a, b) => {
    const byStatus =
      STATUS_ORDER.indexOf(a.status as StatusKey) -
      STATUS_ORDER.indexOf(b.status as StatusKey);
    return byStatus !== 0 ? byStatus : (a.invoiceNumber ?? 0) - (b.invoiceNumber ?? 0);
  });

  return (
    <main>
      <h1>Invoices</h1>
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

      {ordered.length === 0 ? (
        <p>No invoices yet. Create a customer first, then an invoice.</p>
      ) : (
        <table>
          <caption>
            {ordered.length} invoice{ordered.length !== 1 ? "s" : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Customer</th>
              <th scope="col">Date</th>
              <th scope="col">Due</th>
              <th scope="col">Amount</th>
              <th scope="col">Paid</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((inv: InvoiceSummary) => (
              <tr key={inv.id}>
                <td>{inv.invoiceNumber ?? "—"}</td>
                <td>{inv.customerName}</td>
                <td>{inv.issueDate.toISOString().slice(0, 10)}</td>
                <td>{inv.dueDate.toISOString().slice(0, 10)}</td>
                <td>{Number(inv.totalAmount).toFixed(2)}</td>
                <td>{Number(inv.amountPaid).toFixed(2)}</td>
                <td>{Number(inv.amountDue).toFixed(2)}</td>
                <td>{inv.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewInvoice orgSlug={orgSlug} />
    </main>
  );
}

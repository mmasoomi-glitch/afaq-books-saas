import type { Metadata } from "next";
import type { PaymentSummary } from "../../../../../modules/sales/customer-payments";
import { cachedPageScope } from "../../../../../server/next/page-scope-cache";
import { guardedListPayments } from "../../../../../modules/sales/guarded";

export const metadata: Metadata = {
  title: "Payments · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function PaymentsPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const payments = await guardedListPayments(scope);

  return (
    <main>
      <h1>Customer payments</h1>
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

      {payments.length === 0 ? (
        <p>No payments recorded yet.</p>
      ) : (
        <table>
          <caption>
            {payments.length} payment{payments.length !== 1 ? "s" : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Customer</th>
              <th scope="col">Date</th>
              <th scope="col">Amount</th>
              <th scope="col">Method</th>
              <th scope="col">Reference</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p: PaymentSummary) => (
              <tr key={p.id}>
                <td>{p.paymentNumber ?? "—"}</td>
                <td>{(p as unknown as { customerName?: string }).customerName ?? "—"}</td>
                <td>{p.paymentDate.toISOString().slice(0, 10)}</td>
                <td>{Number(p.amount).toFixed(2)}</td>
                <td>{p.method}</td>
                <td>{p.reference ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

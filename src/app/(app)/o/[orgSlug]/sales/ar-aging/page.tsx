import type { Metadata } from "next";
import type { AgingBucket, CustomerAging } from "../../../../../../modules/sales/ar-aging";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedArAging } from "../../../../../../modules/sales/guarded";

export const metadata: Metadata = {
  title: "AR aging · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function ArAgingPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const aging = await guardedArAging(scope);

  return (
    <main>
      <h1>Accounts receivable aging</h1>
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

      <p>
        As of <time dateTime={aging.asOf}>{aging.asOf.slice(0, 10)}</time>.
      </p>

      {aging.totals.length === 0 ? (
        <p>All invoices are settled.</p>
      ) : (
        <>
          <table>
            <caption>Outstanding by bucket</caption>
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {aging.totals.map((b: AgingBucket) => (
                <tr key={b.bucket}>
                  <td>{b.bucket}</td>
                  <td>{Number(b.totalDue).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Customer detail</h2>
          {aging.customers.length === 0 ? (
            <p>No open receivables.</p>
          ) : (
            <table>
              <caption>Outstanding by customer</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Current</th>
                  <th scope="col">1–30</th>
                  <th scope="col">31–60</th>
                  <th scope="col">61–90</th>
                  <th scope="col">90+</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {aging.customers.map((c: CustomerAging) => (
                  <tr key={c.customerId}>
                    <td>{c.customerName}</td>
                    <td>{Number(c.buckets.find(b => b.bucket === "current")?.totalDue ?? 0).toFixed(2)}</td>
                    <td>{Number(c.buckets.find(b => b.bucket === "1-30")?.totalDue ?? 0).toFixed(2)}</td>
                    <td>{Number(c.buckets.find(b => b.bucket === "31-60")?.totalDue ?? 0).toFixed(2)}</td>
                    <td>{Number(c.buckets.find(b => b.bucket === "61-90")?.totalDue ?? 0).toFixed(2)}</td>
                    <td>{Number(c.buckets.find(b => b.bucket === "90+")?.totalDue ?? 0).toFixed(2)}</td>
                    <td>{Number(c.totalDue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}

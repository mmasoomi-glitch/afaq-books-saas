import type { Metadata } from "next";
import type { CustomerSummary } from "../../../../../../modules/sales/customers";
import { cachedPageScope } from "../../../../../../server/next/page-scope-cache";
import { guardedListCustomers } from "../../../../../../modules/sales/guarded";
import { can } from "../../../../../../server/auth/permissions";
import NewCustomer from "./NewCustomer";

export const metadata: Metadata = {
  title: "Customers · Naqdengi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ orgSlug: string }>;
}

export default async function CustomersPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const scope = await cachedPageScope(orgSlug);
  const customers = await guardedListCustomers(scope);

  return (
    <main>
      <h1>Customers</h1>
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

      {customers.length === 0 ? (
        <p>
          No customers yet. Every invoice names a customer, so the list has to
          come first.
        </p>
      ) : (
        <table>
          <caption>All customers in this organization.</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Currency</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c: CustomerSummary) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.currency}</td>
                <td>{c.isActive ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {can(scope.role, "sales.customer.create") ? (
        <NewCustomer orgSlug={orgSlug} />
      ) : null}
    </main>
  );
}

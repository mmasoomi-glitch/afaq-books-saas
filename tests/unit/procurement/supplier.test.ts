import { expect, test } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
  deactivateSupplier,
} from "../../../src/modules/procurement/suppliers";
import { NotFoundError } from "../../../src/modules/ledger/errors";

const scope = unsafeCreateLedgerScope("test-user-1", "test-org-1");

function seedOrg() {
  return prisma.$executeRaw`
    INSERT INTO organizations (id, slug, name, created_at, updated_at)
    VALUES ('test-org-1', 'test-org-1', 'Test Org 1', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}

function seedUser() {
  return prisma.$executeRaw`
    INSERT INTO users (id, email, created_at, updated_at)
    VALUES ('test-user-1', 'test@example.com', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}

test("CRUD suppliers end-to-end", async () => {
  await seedOrg();
  await seedUser();

  // Create
  const supplier = await createSupplier(scope, {
    name: "Test Supplier",
    email: "supplier@test.com",
    phone: "555-0100",
    taxId: "TAX-001",
    currency: "USD",
    accountNumber: "ACCT-001",
    paymentTerms: 45,
  });

  expect(supplier.name).toBe("Test Supplier");
  expect(supplier.email).toBe("supplier@test.com");
  expect(supplier.currency).toBe("USD");
  expect(supplier.paymentTerms).toBe(45);
  expect(supplier.isActive).toBe(true);

  // Get
  const fetched = await getSupplier(scope, supplier.id);
  expect(fetched).not.toBeNull();
  expect(fetched!.name).toBe("Test Supplier");

  // List
  const list = await listSuppliers(scope);
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(supplier.id);

  // Update
  const updated = await updateSupplier(scope, supplier.id, {
    name: "Updated Supplier",
    phone: "555-0200",
  });
  expect(updated.name).toBe("Updated Supplier");
  expect(updated.phone).toBe("555-0200");
  // Unchanged fields preserved
  expect(updated.email).toBe("supplier@test.com");

  // Deactivate
  const deactivated = await deactivateSupplier(scope, supplier.id);
  expect(deactivated.isActive).toBe(false);

  // List filtered by isActive
  const activeList = await listSuppliers(scope, { isActive: true });
  expect(activeList).toHaveLength(0);

  const inactiveList = await listSuppliers(scope, { isActive: false });
  expect(inactiveList).toHaveLength(1);
});

test("getSupplier returns null for foreign id", async () => {
  await seedOrg();
  await seedUser();
  const result = await getSupplier(scope, "00000000-0000-0000-0000-000000000000");
  expect(result).toBeNull();
});

test("updateSupplier throws NotFoundError for foreign id", async () => {
  await seedOrg();
  await seedUser();
  await expect(
    updateSupplier(scope, "00000000-0000-0000-0000-000000000000", { name: "x" }),
  ).rejects.toThrow(NotFoundError);
});

test("duplicate email in same org is rejected", async () => {
  await seedOrg();
  await seedUser();

  await createSupplier(scope, { name: "Supplier A", email: "dup@test.com" });

  await expect(
    createSupplier(scope, { name: "Supplier B", email: "dup@test.com" }),
  ).rejects.toThrow();
});

test("duplicate accountNumber in same org is rejected", async () => {
  await seedOrg();
  await seedUser();

  await createSupplier(scope, {
    name: "Supplier A",
    accountNumber: "ACCT-DUP",
  });

  await expect(
    createSupplier(scope, { name: "Supplier B", accountNumber: "ACCT-DUP" }),
  ).rejects.toThrow();
});

test("search filters by name, email, and accountNumber", async () => {
  await seedOrg();
  await seedUser();

  await createSupplier(scope, { name: "Alpha Corp", email: "alpha@test.com" });
  await createSupplier(scope, { name: "Beta Inc", email: "beta@test.com" });
  await createSupplier(scope, { name: "Alpha Labs", accountNumber: "XL-200" });

  const byName = await listSuppliers(scope, { search: "Alpha" });
  expect(byName).toHaveLength(2);

  const byEmail = await listSuppliers(scope, { search: "beta" });
  expect(byEmail).toHaveLength(1);
  expect(byEmail[0].name).toBe("Beta Inc");

  const byAccount = await listSuppliers(scope, { search: "XL-200" });
  expect(byAccount).toHaveLength(1);
});

test("default values: currency=USD, paymentTerms=30, isActive=true", async () => {
  await seedOrg();
  await seedUser();

  const s = await createSupplier(scope, { name: "Minimal Supplier" });
  expect(s.currency).toBe("USD");
  expect(s.paymentTerms).toBe(30);
  expect(s.isActive).toBe(true);
});

import { expect, test } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";
import { apAging } from "../../../src/modules/procurement/ap-aging";
import { createSupplier } from "../../../src/modules/procurement/suppliers";
import { createBill } from "../../../src/modules/procurement/bills";
import { approveBill } from "../../../src/modules/procurement/bills";
import { createPeriod } from "../../../src/modules/ledger/periods";

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

async function seedSupplier(name: string, currency: string = "USD") {
  return createSupplier(scope, { name, email: `${name.toLowerCase()}@test.com`, currency });
}

async function seedExpenseAccount() {
  return prisma.account.create({
    data: {
      organizationId: "test-org-1",
      code: "6000",
      name: "Office Supplies Expense",
      type: "EXPENSE",
      currency: "USD",
    },
  });
}

async function seedPeriod() {
  const today = new Date();
  return createPeriod(scope, {
    name: `2025-01`,
    startDate: new Date(today.getFullYear(), 0, 1),
    endDate: new Date(today.getFullYear(), 0, 31),
  });
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

test("apAging returns empty when no bills", async () => {
  await seedOrg();
  await seedUser();
  await seedPeriod();

  const result = await apAging(scope, new Date());
  expect(result.suppliers).toHaveLength(0);
  expect(result.totals.total).toBe("0");
});

test("apAging buckets bills correctly by dueDate", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier("Supplier A");
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  // Current bill (dueDate is in the future or 0 days overdue)
  const bill1 = await createBill(scope, {
    supplierId: supplier.id,
    billDate: daysAgo(10),
    dueDate: daysFromNow(5),
    lines: [
      {
        lineNumber: 1,
        description: "Current bill",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });
  await approveBill(scope, bill1.id, "test-user-1");

  // 1-30 overdue
  const bill2 = await createBill(scope, {
    supplierId: supplier.id,
    billDate: daysAgo(50),
    dueDate: daysAgo(15),
    lines: [
      {
        lineNumber: 1,
        description: "1-30 overdue",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 200,
        taxRate: 0,
      },
    ],
  });
  await approveBill(scope, bill2.id, "test-user-1");

  // 31-60 overdue
  const bill3 = await createBill(scope, {
    supplierId: supplier.id,
    billDate: daysAgo(80),
    dueDate: daysAgo(45),
    lines: [
      {
        lineNumber: 1,
        description: "31-60 overdue",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 300,
        taxRate: 0,
      },
    ],
  });
  await approveBill(scope, bill3.id, "test-user-1");

  const asOf = new Date();
  const result = await apAging(scope, asOf);

  expect(result.suppliers).toHaveLength(1);
  expect(result.suppliers[0].supplierName).toBe("Supplier A");

  const buckets = result.suppliers[0].buckets;
  const currentBucket = buckets.find((b) => b.label === "Current")!;
  const oneToThirty = buckets.find((b) => b.label === "1-30")!;
  const thirtyOneToSixty = buckets.find((b) => b.label === "31-60")!;

  expect(currentBucket.amount).toBe("100");
  expect(oneToThirty.amount).toBe("200");
  expect(thirtyOneToSixty.amount).toBe("300");

  expect(result.totals.total).toBe("600");
});

test("apAging excludes PAID and CANCELLED bills", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier("Supplier B");
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  const paidBill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: daysAgo(30),
    dueDate: daysAgo(15),
    lines: [
      {
        lineNumber: 1,
        description: "Paid bill",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });
  await approveBill(scope, paidBill.id, "test-user-1");
  // Manually set to PAID
  await prisma.bill.update({
    where: { id: paidBill.id },
    data: { status: "PAID", amountPaid: 100, amountDue: 0 },
  });

  const result = await apAging(scope, new Date());
  expect(result.suppliers).toHaveLength(0);
});

test("apAging groups by supplier", async () => {
  await seedOrg();
  await seedUser();
  const supplier1 = await seedSupplier("Supplier 1");
  const supplier2 = await seedSupplier("Supplier 2");
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  for (const supplier of [supplier1, supplier2]) {
    const bill = await createBill(scope, {
      supplierId: supplier.id,
      billDate: daysAgo(10),
      dueDate: daysFromNow(5),
      lines: [
        {
          lineNumber: 1,
          description: "Bill",
          accountId: expenseAccount.id,
          quantity: 1,
          unitPrice: 150,
          taxRate: 0,
        },
      ],
    });
    await approveBill(scope, bill.id, "test-user-1");
  }

  const result = await apAging(scope, new Date());
  expect(result.suppliers).toHaveLength(2);

  const supplier1Row = result.suppliers.find((r) => r.supplierName === "Supplier 1")!;
  const supplier2Row = result.suppliers.find((r) => r.supplierName === "Supplier 2")!;

  expect(supplier1Row.totalDue).toBe("150");
  expect(supplier2Row.totalDue).toBe("150");
  expect(result.totals.total).toBe("300");
});

test("apAging excludes DRAFT bills", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier("Supplier C");
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  // DRAFT bill
  await createBill(scope, {
    supplierId: supplier.id,
    billDate: daysAgo(10),
    dueDate: daysAgo(5),
    lines: [
      {
        lineNumber: 1,
        description: "Draft bill",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });

  const result = await apAging(scope, new Date());
  expect(result.suppliers).toHaveLength(0);
});

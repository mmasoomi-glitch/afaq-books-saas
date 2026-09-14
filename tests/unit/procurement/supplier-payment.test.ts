import { expect, test } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";
import {
  createSupplierPayment,
  applyPayment,
  unapplyPayment,
} from "../../../src/modules/procurement/supplier-payments";
import { createBill } from "../../../src/modules/procurement/bills";
import { approveBill } from "../../../src/modules/procurement/bills";
import { createSupplier } from "../../../src/modules/procurement/suppliers";
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

async function seedLiabilityAccount() {
  return prisma.account.create({
    data: {
      organizationId: "test-org-1",
      code: "2000",
      name: "Accounts Payable",
      type: "LIABILITY",
      currency: "USD",
    },
  });
}

async function seedAssetAccount() {
  return prisma.account.create({
    data: {
      organizationId: "test-org-1",
      code: "1000",
      name: "Bank Account",
      type: "ASSET",
      currency: "USD",
    },
  });
}

async function seedSupplier() {
  return createSupplier(scope, { name: "Test Supplier", email: "test@supplier.com" });
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

test("createSupplierPayment records payment", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 1000,
    method: "WIRE",
    reference: "WIRE-001",
  });

  expect(payment.supplierId).toBe(supplier.id);
  expect(payment.amount.toString()).toBe("1000");
  expect(payment.method).toBe("WIRE");
  expect(payment.reference).toBe("WIRE-001");
  expect(payment.currency).toBe("USD");
});

test("applyPayment allocates to bill and creates journal entry", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  // Create and approve a bill
  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Service",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 500,
        taxRate: 0,
      },
    ],
  });

  await approveBill(scope, bill.id, "test-user-1");

  const billAfterApprove = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(billAfterApprove!.amountDue.toString()).toBe("500");

  // Create payment
  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 500,
    method: "WIRE",
  });

  // Apply to bill
  const result = await applyPayment(scope, payment.id, [
    { billId: bill.id, amount: 500 },
  ]);

  expect(result.allocations.length).toBe(1);
  expect(result.allocations[0].amount.toString()).toBe("500");

  // Bill should be fully paid
  const updatedBill = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(updatedBill!.status).toBe("PAID");
  expect(updatedBill!.amountPaid.toString()).toBe("500");
  expect(updatedBill!.amountDue.toString()).toBe("0");

  // Journal entry exists
  const je = await prisma.journalEntry.findFirst({
    where: {
      organizationId: "test-org-1",
      sourceModule: "procurement",
    },
  });
  expect(je).not.toBeNull();
});

test("bill goes to PARTIAL status when partially paid", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Service",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 1000,
        taxRate: 0,
      },
    ],
  });

  await approveBill(scope, bill.id, "test-user-1");

  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 500,
    method: "WIRE",
  });

  await applyPayment(scope, payment.id, [
    { billId: bill.id, amount: 500 },
  ]);

  const updatedBill = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(updatedBill!.status).toBe("PARTIAL");
  expect(updatedBill!.amountPaid.toString()).toBe("500");
  expect(updatedBill!.amountDue.toString()).toBe("500");
});

test("payment allocation cannot exceed payment amount", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 100,
    method: "WIRE",
  });

  await expect(
    applyPayment(scope, payment.id, [
      { billId: "00000000-0000-0000-0000-000000000000", amount: 500 },
    ]),
  ).rejects.toThrow();
});

test("unapplyPayment reverses allocation", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Service",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 500,
        taxRate: 0,
      },
    ],
  });

  await approveBill(scope, bill.id, "test-user-1");

  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 500,
    method: "WIRE",
  });

  const { allocations } = await applyPayment(scope, payment.id, [
    { billId: bill.id, amount: 500 },
  ]);

  expect(allocations.length).toBe(1);
  const billAfterApply = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(billAfterApply!.status).toBe("PAID");

  // Unapply
  const removed = await unapplyPayment(scope, allocations[0].id);
  expect(removed.amount.toString()).toBe("500");

  const billAfterUnapply = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(billAfterUnapply!.status).toBe("APPROVED");
  expect(billAfterUnapply!.amountPaid.toString()).toBe("0");
  expect(billAfterUnapply!.amountDue.toString()).toBe("500");
});

test("unapplied payment (allocation less than payment amount)", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  await seedAssetAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Service",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 300,
        taxRate: 0,
      },
    ],
  });

  await approveBill(scope, bill.id, "test-user-1");

  // Pay more than the bill
  const payment = await createSupplierPayment(scope, {
    supplierId: supplier.id,
    paymentDate: new Date(),
    amount: 500,
    method: "WIRE",
  });

  const result = await applyPayment(scope, payment.id, [
    { billId: bill.id, amount: 300 },
  ]);

  expect(result.allocations[0].amount.toString()).toBe("300");

  const updatedBill = await prisma.bill.findUnique({
    where: { id: bill.id },
  });
  expect(updatedBill!.status).toBe("PAID");
  expect(updatedBill!.amountPaid.toString()).toBe("300");
  expect(updatedBill!.amountDue.toString()).toBe("0");

  // The payment record still has the full amount — the excess is unapplied
  const updatedPayment = await prisma.supplierPayment.findUnique({
    where: { id: payment.id },
  });
  expect(updatedPayment!.amount.toString()).toBe("500");
});

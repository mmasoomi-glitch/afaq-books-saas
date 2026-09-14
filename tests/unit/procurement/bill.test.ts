import { expect, test } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { unsafeCreateLedgerScope } from "../../../src/modules/ledger/scope";
import {
  createBill,
  getBill,
  listBills,
  approveBill,
  cancelBill,
  voidBill,
} from "../../../src/modules/procurement/bills";
import { createSupplier } from "../../../src/modules/procurement/suppliers";

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

async function seedSupplier() {
  return createSupplier(scope, { name: "Test Supplier", email: "test@supplier.com" });
}

async function seedPeriod() {
  const today = new Date();
  return createPeriod(scope, {
    name: `2025-01`,
    startDate: new Date(today.getFullYear(), 0, 1),
    endDate: new Date(today.getFullYear(), 0, 31),
  });
}

test("createBill creates a draft bill with auto-calculated totals", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billNumber: 1001,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    currency: "USD",
    lines: [
      {
        lineNumber: 1,
        description: "Office paper",
        accountId: expenseAccount.id,
        quantity: 10,
        unitPrice: 25,
        taxRate: 0,
      },
      {
        lineNumber: 2,
        description: "Printer ink",
        accountId: expenseAccount.id,
        quantity: 2,
        unitPrice: 75,
        taxRate: 0.1,
      },
    ],
  });

  expect(bill.status).toBe("DRAFT");
  expect(bill.supplierId).toBe(supplier.id);
  expect(bill.billNumber).toBe(1001);
  // Line 1: 10 * 25 = 250
  // Line 2: 2 * 75 = 150, tax = 150 * 0.1 = 15
  // Subtotal: 250 + 150 = 400
  // Tax: 15
  // Total: 415
  expect(parseFloat(bill.subtotal.toString())).toBe(400);
  expect(parseFloat(bill.taxAmount.toString())).toBe(15);
  expect(parseFloat(bill.totalAmount.toString())).toBe(415);
  expect(parseFloat(bill.amountDue.toString())).toBe(415);
  expect(bill.amountPaid.toString()).toBe("0");

  // Lines persisted
  const fullBill = await getBill(scope, bill.id);
  expect(fullBill).not.toBeNull();
  expect(fullBill!.billLines.length).toBe(2);
});

test("listBills filters by status", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  await createBill(scope, {
    supplierId: supplier.id,
    billNumber: 2001,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Item",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });

  const all = await listBills(scope);
  expect(all.length).toBeGreaterThanOrEqual(1);

  const drafts = await listBills(scope, { status: "DRAFT" });
  expect(drafts.length).toBeGreaterThanOrEqual(1);
});

test("approveBill transitions DRAFT -> APPROVED and creates journal entry", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  const _liabilityAccount = await seedLiabilityAccount();
  const _period = await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Consulting",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 500,
        taxRate: 0,
      },
    ],
  });

  expect(bill.status).toBe("DRAFT");

  const approved = await approveBill(scope, bill.id, "test-user-1");
  expect(approved.status).toBe("APPROVED");
  expect(approved.approvedBy).toBe("test-user-1");
  expect(approved.approvedAt).not.toBeNull();

  // Verify journal entry was created
  const je = await prisma.journalEntry.findFirst({
    where: {
      organizationId: "test-org-1",
      sourceId: bill.id,
      sourceModule: "procurement",
    },
  });
  expect(je).not.toBeNull();
  expect(je!.journalLines.length).toBeGreaterThanOrEqual(2); // expense + AP credit
});

test("voidBill works on DRAFT", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Item",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });

  const voided = await voidBill(scope, bill.id);
  expect(voided.status).toBe("CANCELLED");
});

test("voidBill rejects non-DRAFT", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Item",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });

  await approveBill(scope, bill.id, "test-user-1");

  await expect(voidBill(scope, bill.id)).rejects.toThrow("only DRAFT bills can be voided");
});

test("cancelBill rejects PAID bill", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Item",
        accountId: expenseAccount.id,
        quantity: 1,
        unitPrice: 100,
        taxRate: 0,
      },
    ],
  });

  // Set status to PAID directly to test
  await prisma.bill.update({
    where: { id: bill.id },
    data: { status: "PAID", amountPaid: bill.totalAmount, amountDue: 0 },
  });

  await expect(cancelBill(scope, bill.id, "reason")).rejects.toThrow(
    "cannot cancel a paid bill",
  );
});

test("bill line tax is correctly calculated", async () => {
  await seedOrg();
  await seedUser();
  const supplier = await seedSupplier();
  const expenseAccount = await seedExpenseAccount();
  await seedPeriod();

  const bill = await createBill(scope, {
    supplierId: supplier.id,
    billDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    lines: [
      {
        lineNumber: 1,
        description: "Taxable item",
        accountId: expenseAccount.id,
        quantity: 100,
        unitPrice: 10,
        taxRate: 0.08,
      },
    ],
  });

  // lineTotal = 100 * 10 = 1000
  // taxAmount = 1000 * 0.08 = 80
  // total = 1080
  expect(parseFloat(bill.taxAmount.toString())).toBe(80);
  expect(parseFloat(bill.totalAmount.toString())).toBe(1080);
});

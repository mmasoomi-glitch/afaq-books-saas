import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { resolveOrgScope, toLedgerScope } from "../../../src/server/auth/scope";
import type { OrgScope } from "../../../src/server/auth/scope";
import { NotAMemberError } from "../../../src/server/auth/errors";
import {
  guardedBalanceSheet,
  guardedProfitAndLoss,
  guardedTrialBalance,
} from "../../../src/modules/reports/guarded";
import { createAccount } from "../../../src/modules/ledger/accounts";
import { createPeriod } from "../../../src/modules/ledger/periods";
import { postJournalEntry } from "../../../src/modules/ledger/posting";

const AS_OF = new Date("2024-12-31");
const FROM = new Date("2024-01-01");

function rowByCode(
  rows: ReadonlyArray<{ accountCode: string; debit: string; credit: string }>,
  code: string,
): { accountCode: string; debit: string; credit: string } {
  const row = rows.find((r) => r.accountCode === code);
  if (row === undefined) {
    throw new Error(`no trial-balance row for account ${code}`);
  }
  return row;
}

/** An organization, a user, and a membership joining them with `role`. */
async function actor(role: MembershipRole): Promise<OrgScope> {
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Test" },
  });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, name: "T" },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, role },
  });
  return resolveOrgScope(user.id, org.slug);
}

/** One posted sale: debit Cash 500, credit Revenue 500. */
async function seed(scope: OrgScope): Promise<void> {
  const ledgerScope = toLedgerScope(scope);
  const period = await createPeriod(ledgerScope, {
    name: "2024",
    startDate: FROM,
    endDate: AS_OF,
  });
  const cash = await createAccount(ledgerScope, {
    code: "1000",
    name: "Cash",
    type: "ASSET",
    currency: "USD",
  });
  const revenue = await createAccount(ledgerScope, {
    code: "4000",
    name: "Revenue",
    type: "INCOME",
    currency: "USD",
  });
  await postJournalEntry(ledgerScope, {
    periodId: period.id,
    entryDate: new Date("2024-03-01"),
    description: "Sale",
    currency: "USD",
    lines: [
      { accountId: cash.id, debit: "500" },
      { accountId: revenue.id, credit: "500" },
    ],
  });
}

beforeEach(async () => {
  await resetDb();
});

test("R1: a VIEWER can read the trial balance", async () => {
  const scope = await actor("VIEWER");
  await seed(scope);

  const tb = await guardedTrialBalance(scope, AS_OF);
  const cash = rowByCode(tb.rows, "1000");
  expect(cash.debit).toBe("500.0000");
  expect(cash.credit).toBe("0.0000");
});

test("R2: a VIEWER can read profit and loss", async () => {
  const scope = await actor("VIEWER");
  await seed(scope);

  expect((await guardedProfitAndLoss(scope, FROM, AS_OF)).netProfit).toBe(
    "500.0000",
  );
});

test("R3: a VIEWER can read the balance sheet", async () => {
  const scope = await actor("VIEWER");
  await seed(scope);

  expect((await guardedBalanceSheet(scope, AS_OF)).totalAssets).toBe(
    "500.0000",
  );
});

test("R4: every role may read reports", async () => {
  // report.read is inherited from VIEWER upward, so no role is denied it.
  // This pins that intent: if someone removes report.read from a role, this
  // test says so rather than the omission being discovered in production.
  const roles: MembershipRole[] = [
    "VIEWER",
    "BOOKKEEPER",
    "APPROVER",
    "ACCOUNTANT",
    "ADMIN",
    "OWNER",
  ];
  for (const role of roles) {
    const scope = await actor(role);
    await seed(scope);
    const tb = await guardedTrialBalance(scope, AS_OF);
    expect(tb.totalDebit).toBe("500.0000");
  }
});

test("R5: one tenant's reports never contain another tenant's money", async () => {
  const a = await actor("VIEWER");
  await seed(a);

  const b = await actor("VIEWER"); // deliberately unseeded

  const tb = await guardedTrialBalance(b, AS_OF);
  expect(tb.rows).toHaveLength(0);
  expect(tb.totalDebit).toBe("0.0000");
  expect(tb.totalCredit).toBe("0.0000");

  expect((await guardedBalanceSheet(b, AS_OF)).totalAssets).toBe("0.0000");
  expect((await guardedProfitAndLoss(b, FROM, AS_OF)).netProfit).toBe("0.0000");
});

test("R6: without a membership there is no scope, so no report", async () => {
  // The gate cannot be reached at all without a membership — resolveOrgScope
  // refuses first, and its message does not reveal whether the organization
  // exists.
  const org = await prisma.organization.create({
    data: { slug: `org-${randomUUID().slice(0, 8)}`, name: "Test" },
  });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, name: "T" },
  });

  await expect(resolveOrgScope(user.id, org.slug)).rejects.toBeInstanceOf(
    NotAMemberError,
  );
});

test("R7: the wrapper delegates rather than swallowing errors", async () => {
  const scope = await actor("VIEWER");
  await seed(scope);

  // An inverted range is rejected by the underlying report. If the wrapper
  // caught or ignored that, this would resolve instead of rejecting.
  await expect(guardedProfitAndLoss(scope, AS_OF, FROM)).rejects.toThrow(
    /before/i,
  );
});

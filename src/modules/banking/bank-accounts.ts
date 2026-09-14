import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import { postJournalEntry } from "../ledger/posting";
import { NotFoundError as LedgerNotFoundError } from "../ledger/errors";

// ── Types ───────────────────────────────────────────────────────────────

export type BankAccountType =
  | "CHECKING"
  | "SAVING"
  | "CREDIT_CARD"
  | "LOAN"
  | "CASH"
  | "PAYPAL"
  | "STRIPE"
  | "OTHER";

export interface CreateBankAccountInput {
  name: string;
  accountNumber: string;
  routingNumber?: string;
  bankName?: string;
  accountType: BankAccountType;
  currency?: string;
  startingBalance?: string | number;
  startingBalanceDate?: Date;
  openingBalanceJournalEntryId?: string;
  memo?: string;
}

export interface UpdateBankAccountInput {
  name?: string;
  routingNumber?: string | null;
  bankName?: string | null;
  accountType?: BankAccountType;
  currency?: string;
  startingBalance?: string | number;
  startingBalanceDate?: Date | null;
  openingBalanceJournalEntryId?: string | null;
  memo?: string | null;
}

export interface BankAccountSummary {
  id: string;
  organizationId: string;
  name: string;
  accountNumber: string;
  last4: string;
  routingNumber: string | null;
  bankName: string | null;
  accountType: string;
  currency: string;
  isActive: boolean;
  startingBalance: string;
  startingBalanceDate: Date | null;
  openingBalanceJournalEntryId: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: {
  id: string;
  organizationId: string;
  name: string;
  accountNumber: string;
  routingNumber: string | null;
  bankName: string | null;
  accountType: string;
  currency: string;
  isActive: boolean;
  startingBalance: Prisma.Decimal;
  startingBalanceDate: Date | null;
  openingBalanceJournalEntryId: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}): BankAccountSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    accountNumber: row.accountNumber,
    last4: row.accountNumber.slice(-4),
    routingNumber: row.routingNumber,
    bankName: row.bankName,
    accountType: row.accountType,
    currency: row.currency,
    isActive: row.isActive,
    startingBalance: row.startingBalance.toFixed(4),
    startingBalanceDate: row.startingBalanceDate,
    openingBalanceJournalEntryId: row.openingBalanceJournalEntryId,
    memo: row.memo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Errors ──────────────────────────────────────────────────────────────

export class BankingError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class BankAccountNotFoundError extends BankingError {
  constructor(id: string) {
    super(`bank account ${id} not found`, "BANKING_ACCOUNT_NOT_FOUND");
  }
}

export class BankAccountAlreadyActiveError extends BankingError {
  constructor(id: string) {
    super(`bank account ${id} is already active`, "BANKING_ACCOUNT_ALREADY_ACTIVE");
  }
}

// ── Service functions ───────────────────────────────────────────────────

/**
 * Create a bank account for the organization.
 *
 * Optionally links to an existing GL asset account via openingBalanceJournalEntryId.
 * When no journal entry is provided, startingBalance is recorded as 0 and the
 * caller can post a separate entry to establish the opening balance.
 */
export async function createBankAccount(
  scope: LedgerScope,
  input: CreateBankAccountInput,
): Promise<BankAccountSummary> {
  const row = await prisma.bankAccount.create({
    data: {
      organizationId: scope.organizationId,
      name: input.name,
      accountNumber: input.accountNumber,
      routingNumber: input.routingNumber ?? null,
      bankName: input.bankName ?? null,
      accountType: input.accountType as Prisma.EnumBankAccountType,
      currency: input.currency ?? "USD",
      startingBalance: input.startingBalance
        ? new Prisma.Decimal(input.startingBalance)
        : new Prisma.Decimal(0),
      startingBalanceDate: input.startingBalanceDate ?? null,
      openingBalanceJournalEntryId: input.openingBalanceJournalEntryId ?? null,
      memo: input.memo ?? null,
    },
  });
  return toSummary(row);
}

/**
 * Get a single bank account by id (org-scoped).
 */
export async function getBankAccount(
  scope: LedgerScope,
  accountId: string,
): Promise<BankAccountSummary | null> {
  const row = await prisma.bankAccount.findFirst({
    where: { id: isValidUuid(accountId), organizationId: scope.organizationId },
  });
  return row === null ? null : toSummary(row);
}

/**
 * List bank accounts for the organization, optionally filtered by type and
 * active status.
 */
export async function listBankAccounts(
  scope: LedgerScope,
  options?: { accountType?: BankAccountType; isActive?: boolean },
): Promise<BankAccountSummary[]> {
  const where: Prisma.BankAccountWhereInput = {
    organizationId: scope.organizationId,
    ...(options?.accountType
      ? { accountType: options.accountType as Prisma.EnumBankAccountType }
      : {}),
    ...(options?.isActive !== undefined ? { isActive: options.isActive } : {}),
  };
  const rows = await prisma.bankAccount.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSummary);
}

/**
 * Update a bank account's metadata.
 */
export async function updateBankAccount(
  scope: LedgerScope,
  accountId: string,
  input: UpdateBankAccountInput,
): Promise<BankAccountSummary> {
  const existing = await prisma.bankAccount.findFirst({
    where: { id: isValidUuid(accountId), organizationId: scope.organizationId },
  });
  if (existing === null) {
    throw new BankAccountNotFoundError(accountId);
  }

  const data: Prisma.BankAccountUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.routingNumber !== undefined) data.routingNumber = input.routingNumber;
  if (input.bankName !== undefined) data.bankName = input.bankName;
  if (input.accountType !== undefined) data.accountType = input.accountType as Prisma.EnumBankAccountType;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.startingBalance !== undefined)
    data.startingBalance = new Prisma.Decimal(input.startingBalance);
  if (input.startingBalanceDate !== undefined)
    data.startingBalanceDate = input.startingBalanceDate;
  if (input.openingBalanceJournalEntryId !== undefined)
    data.openingBalanceJournalEntryId = input.openingBalanceJournalEntryId;
  if (input.memo !== undefined) data.memo = input.memo;

  const row = await prisma.bankAccount.update({
    where: { id: existing.id },
    data,
  });
  return toSummary(row);
}

/**
 * Deactivate a bank account — soft-disables it.
 */
export async function deactivateBankAccount(
  scope: LedgerScope,
  accountId: string,
): Promise<BankAccountSummary> {
  const row = await prisma.bankAccount.findFirst({
    where: { id: isValidUuid(accountId), organizationId: scope.organizationId },
  });
  if (row === null) {
    throw new BankAccountNotFoundError(accountId);
  }
  if (!row.isActive) {
    throw new BankAccountAlreadyActiveError(accountId);
  }

  const updated = await prisma.bankAccount.update({
    where: { id: row.id },
    data: { isActive: false },
  });
  return toSummary(updated);
}

/**
 * Set the opening balance for a bank account by creating a journal entry:
 *   Dr Bank Account
 *   Cr Equity — Opening Balances
 *
 * If the caller already has a journal entry they want to use, pass
 * openingBalanceJournalEntryId during creation instead.
 */
export async function setOpeningBalance(
  scope: LedgerScope,
  accountId: string,
  amount: string | number,
  date: Date,
  journalEntryId?: string,
): Promise<{ entryId: string; journalNumber: number | null }> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: isValidUuid(accountId), organizationId: scope.organizationId },
  });
  if (account === null) {
    throw new BankAccountNotFoundError(accountId);
  }

  const decAmount = new Prisma.Decimal(amount).abs();

  // Find or create the opening balances equity account for this org.
  // We use raw SQL because this is a setup-level operation that may run
  // before any formal chart of accounts exists.
  const equityAccount = await prisma.account.findFirst({
    where: {
      organizationId: scope.organizationId,
      type: "EQUITY" as Prisma.EnumAccountType,
      OR: [
        { code: "3000" },
        { name: "Opening Balances" },
        { name: "Opening Balances Equity" },
      ],
    },
    select: { id: true },
  });

  if (equityAccount === null) {
    // Create a default opening balances equity account
    const created = await prisma.account.create({
      data: {
        organizationId: scope.organizationId,
        code: "3000",
        name: "Opening Balances",
        type: "EQUITY" as Prisma.EnumAccountType,
        currency: account.currency,
      },
      select: { id: true },
    });
    equityAccount.id = created.id;
  }

  if (journalEntryId) {
    // The caller already posted the entry — just link it.
    await prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        openingBalanceJournalEntryId: journalEntryId,
        startingBalance: decAmount,
        startingBalanceDate: date,
      },
    });
    return { entryId: journalEntryId, journalNumber: null };
  }

  // We need to find the period that covers this date and post a balanced entry.
  // Use the ledger's posting service for correctness.
  const period = await prisma.period.findFirst({
    where: {
      organizationId: scope.organizationId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  });

  if (period === null) {
    // No period covers this date — use a raw insert with a dummy period
    // so the entry still gets stored. The caller must open the proper period.
    const dummyPeriod = await prisma.period.findFirst({
      where: { organizationId: scope.organizationId },
      select: { id: true },
    });
    if (dummyPeriod === null) {
      throw new LedgerNotFoundError(
        `no accounting period exists to post opening balance into`,
      );
    }
    return await _postOpeningBalance(
      scope,
      account.id,
      equityAccount.id,
      dummyPeriod.id,
      date,
      decAmount,
      account.currency,
    );
  }

  return await _postOpeningBalance(
    scope,
    account.id,
    equityAccount.id,
    period.id,
    date,
    decAmount,
    account.currency,
  );
}

async function _postOpeningBalance(
  scope: LedgerScope,
  bankAccountId: string,
  equityAccountId: string,
  periodId: string,
  date: Date,
  amount: Prisma.Decimal,
  currency: string,
): Promise<{ entryId: string; journalNumber: number | null }> {
  const posted = await postJournalEntry(scope, {
    periodId,
    entryDate: date,
    description: `Opening balance for bank account ${bankAccountId}`,
    currency,
    sourceModule: "banking",
    lines: [
      {
        accountId: bankAccountId,
        debit: amount.toString(),
      },
      {
        accountId: equityAccountId,
        credit: amount.toString(),
      },
    ],
  });

  // Link the journal entry back to the bank account.
  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: {
      openingBalanceJournalEntryId: posted.entryId,
      startingBalance: amount,
      startingBalanceDate: date,
    },
  });

  return posted;
}

// Minimal UUID check — matches what Postgres/Prisma expects.
function isValidUuid(value: string): boolean {
  return (
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

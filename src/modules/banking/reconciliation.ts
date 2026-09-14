import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

const TOLERANCE = new Prisma.Decimal("0.005");

// ── Types ───────────────────────────────────────────────────────────────

export type ReconciliationStatus = "DRAFT" | "COMPLETED" | "LOCKED";

export interface CreateReconciliationInput {
  bankAccountId: string;
  statementDate: Date;
  endBalance: string | number;
}

export interface ReconciliationSummary {
  id: string;
  organizationId: string;
  bankAccountId: string;
  statementDate: Date;
  statementEndBalance: string;
  endingBalance: string;
  difference: string;
  status: string;
  reconciledBy: string | null;
  reconciledAt: Date | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconciliationEntrySummary {
  id: string;
  reconciliationId: string;
  bankTransactionId: string;
  journalEntryId: string | null;
  matchedAmount: string;
  difference: string;
  isMatch: boolean;
  transactionDate: Date | null;
  transactionDescription: string | null;
  transactionAmount: string | null;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class ReconciliationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class ReconciliationNotFoundError extends ReconciliationError {
  constructor(id: string) {
    super(`reconciliation ${id} not found`, "BANKING_RECONCILIATION_NOT_FOUND");
  }
}

export class ReconciliationNotDraftError extends ReconciliationError {
  constructor(id: string, status: string) {
    super(
      `reconciliation ${id} has status ${status} and cannot be modified`,
      "BANKING_RECONCILIATION_NOT_DRAFT",
    );
  }
}

export class ReconciliationDifferenceError extends ReconciliationError {
  constructor(difference: string) {
    super(
      `reconciliation difference is ${difference} and must be zero to complete`,
      "BANKING_RECONCILIATION_DIFFERENCE",
    );
  }
}

export class ReconciliationLockedError extends ReconciliationError {
  constructor(id: string) {
    super(`reconciliation ${id} is locked and cannot be modified`, "BANKING_RECONCILIATION_LOCKED");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function toSummary(row: {
  id: string;
  organizationId: string;
  bankAccountId: string;
  statementDate: Date;
  statementEndBalance: Prisma.Decimal;
  endingBalance: Prisma.Decimal;
  difference: Prisma.Decimal;
  status: string;
  reconciledBy: string | null;
  reconciledAt: Date | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ReconciliationSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    bankAccountId: row.bankAccountId,
    statementDate: row.statementDate,
    statementEndBalance: row.statementEndBalance.toFixed(4),
    endingBalance: row.endingBalance.toFixed(4),
    difference: row.difference.toFixed(4),
    status: row.status,
    reconciledBy: row.reconciledBy,
    reconciledAt: row.reconciledAt,
    memo: row.memo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Service functions ───────────────────────────────────────────────────

/**
 * Create a DRAFT reconciliation for a bank account on a given statement date.
 */
export async function createReconciliation(
  scope: LedgerScope,
  input: CreateReconciliationInput,
): Promise<ReconciliationSummary> {
  // Verify bank account belongs to this org.
  const account = await prisma.bankAccount.findFirst({
    where: { id: input.bankAccountId, organizationId: scope.organizationId },
  });
  if (account === null) {
    throw new NotFoundError(`bank account ${input.bankAccountId} not found`);
  }

  // Check for existing reconciliation on this date.
  const existing = await prisma.reconciliation.findFirst({
    where: {
      organizationId: scope.organizationId,
      bankAccountId: input.bankAccountId,
      statementDate: { equals: input.statementDate },
    },
  });
  if (existing !== null) {
    throw new ReconciliationError(
      `a reconciliation already exists for bank account ${input.bankAccountId} on ${input.statementDate.toISOString().slice(0, 10)}`,
      "BANKING_RECONCILIATION_EXISTS",
    );
  }

  const row = await prisma.reconciliation.create({
    data: {
      organizationId: scope.organizationId,
      bankAccountId: input.bankAccountId,
      statementDate: input.statementDate,
      statementEndBalance: new Prisma.Decimal(input.endBalance),
      endingBalance: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(0),
      status: "DRAFT" as Prisma.EnumReconciliationStatus,
      memo: null,
    },
  });

  return toSummary(row);
}

/**
 * Add a transaction to a reconciliation.
 */
export async function addTransactionToReconciliation(
  scope: LedgerScope,
  reconciliationId: string,
  transactionId: string,
  journalEntryId?: string,
): Promise<ReconciliationEntrySummary> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }
  if (rec.status !== "DRAFT") {
    throw new ReconciliationNotDraftError(reconciliationId, rec.status);
  }

  // Verify the transaction belongs to the same bank account as the reconciliation.
  const tx = await prisma.bankTransaction.findFirst({
    where: {
      id: transactionId,
      organizationId: scope.organizationId,
      bankAccountId: rec.bankAccountId,
    },
  });
  if (tx === null) {
    throw new NotFoundError(
      `transaction ${transactionId} not found on account ${rec.bankAccountId}`,
    );
  }

  // Check for duplicate entry in this reconciliation.
  const existing = await prisma.reconciliationEntry.findFirst({
    where: {
      reconciliationId,
      bankTransactionId: transactionId,
    },
  });
  if (existing !== null) {
    throw new ReconciliationError(
      `transaction ${transactionId} is already in reconciliation ${reconciliationId}`,
      "BANKING_RECONCILIATION_DUPLICATE",
    );
  }

  const entry = await prisma.reconciliationEntry.create({
    data: {
      organizationId: scope.organizationId,
      reconciliationId,
      bankTransactionId: transactionId,
      journalEntryId: journalEntryId ?? null,
      matchedAmount: tx.amount,
      difference: new Prisma.Decimal(0),
      isMatch: false,
    },
    include: {
      bankTransaction: {
        select: {
          transactionDate: true,
          description: true,
          amount: true,
        },
      },
    },
  });

  return toEntrySummary(entry, entry.bankTransaction);
}

interface EntryWithTransaction {
  id: string;
  organizationId: string;
  reconciliationId: string;
  bankTransactionId: string;
  journalEntryId: string | null;
  matchedAmount: Prisma.Decimal;
  difference: Prisma.Decimal;
  isMatch: boolean;
  createdAt: Date;
  bankTransaction: {
    transactionDate: Date | null;
    description: string;
    amount: Prisma.Decimal;
  };
}

function toEntrySummary(
  entry: EntryWithTransaction,
  tx: {
    transactionDate: Date | null;
    description: string;
    amount: Prisma.Decimal;
  },
): ReconciliationEntrySummary {
  return {
    id: entry.id,
    reconciliationId: entry.reconciliationId,
    bankTransactionId: entry.bankTransactionId,
    journalEntryId: entry.journalEntryId,
    matchedAmount: entry.matchedAmount.toFixed(4),
    difference: entry.difference.toFixed(4),
    isMatch: entry.isMatch,
    transactionDate: tx.transactionDate,
    transactionDescription: tx.description,
    transactionAmount: tx.amount.toFixed(4),
  };
}

/**
 * Auto-populate a reconciliation by matching all unmatched transactions
 * to existing journal entries based on heuristics.
 */
export async function autoPopulateReconciliation(
  scope: LedgerScope,
  reconciliationId: string,
): Promise<{ added: number; matched: number }> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }
  if (rec.status !== "DRAFT") {
    throw new ReconciliationNotDraftError(reconciliationId, rec.status);
  }

  const stmtDate = rec.statementDate;
  const threeDays = new Date(stmtDate);
  threeDays.setDate(threeDays.getDate() + 3);

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      organizationId: scope.organizationId,
      bankAccountId: rec.bankAccountId,
      status: "UNMATCHED",
      transactionDate: {
        gte: new Date(new Date(stmtDate).setMonth(new Date(stmtDate).getMonth() - 1)),
        lte: threeDays,
      },
    },
  });

  let added = 0;
  let matched = 0;

  for (const tx of transactions) {
    const existingEntry = await prisma.reconciliationEntry.findFirst({
      where: { reconciliationId, bankTransactionId: tx.id },
    });
    if (existingEntry) continue;

    const journalEntryId = await _findMatchingJournalEntry(scope, tx);
    const isMatch = journalEntryId !== null;

    await prisma.reconciliationEntry.create({
      data: {
        organizationId: scope.organizationId,
        reconciliationId,
        bankTransactionId: tx.id,
        journalEntryId: journalEntryId ?? null,
        matchedAmount: tx.amount,
        difference: new Prisma.Decimal(0),
        isMatch,
      },
    });

    if (isMatch) matched++;
    added++;
  }

  return { added, matched };
}

async function _findMatchingJournalEntry(
  scope: LedgerScope,
  tx: {
    amount: Prisma.Decimal;
    transactionDate: Date;
    description: string;
    type: string;
  },
): Promise<string | null> {
  const lines = await prisma.journalLine.findMany({
    where: {
      organizationId: scope.organizationId,
      journalEntry: {
        postedAt: { not: null },
        entryDate: { equals: tx.transactionDate },
      },
    },
    select: {
      journalEntryId: true,
      debit: true,
      credit: true,
    },
  });

  for (const line of lines) {
    const expected = tx.type === "CREDIT" ? line.credit : line.debit;
    if (expected.equals(tx.amount.abs())) {
      return line.journalEntryId;
    }
  }

  return null;
}

/**
 * Complete a reconciliation — validates that the difference is ≈ 0,
 * computes ending balance, and sets status to COMPLETED.
 */
export async function completeReconciliation(
  scope: LedgerScope,
  reconciliationId: string,
): Promise<ReconciliationSummary> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
    include: {
      reconciliationEntries: {
        select: {
          matchedAmount: true,
          isMatch: true,
        },
      },
    },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }
  if (rec.status !== "DRAFT") {
    throw new ReconciliationNotDraftError(reconciliationId, rec.status);
  }

  // Compute ending balance from reconciliation entries.
  const entries = rec.reconciliationEntries;
  let endingBalance = new Prisma.Decimal(0);
  for (const entry of entries) {
    const amt = entry.matchedAmount;
    endingBalance = entry.isMatch
      ? endingBalance.add(amt)
      : endingBalance.sub(amt);
  }

  const diff = rec.statementEndBalance.sub(endingBalance).abs();

  if (diff.greaterThan(TOLERANCE)) {
    throw new ReconciliationDifferenceError(diff.toFixed(4));
  }

  const updated = await prisma.reconciliation.update({
    where: { id: rec.id },
    data: {
      endingBalance,
      difference: rec.statementEndBalance.sub(endingBalance),
      status: "COMPLETED" as Prisma.EnumReconciliationStatus,
      reconciledBy: scope.userId,
      reconciledAt: new Date(),
    },
    include: {
      reconciliationEntries: {
        select: {
          bankTransaction: {
            select: {
              transactionDate: true,
              description: true,
              amount: true,
            },
          },
        },
      },
    },
  });

  // Write reconciliation entries for the summary.
  const entriesSummary = updated.reconciliationEntries.map(
    (e) => ({
      id: e.id,
      organizationId: e.organizationId,
      reconciliationId: e.reconciliationId,
      bankTransactionId: e.bankTransactionId,
      journalEntryId: e.journalEntryId,
      matchedAmount: e.matchedAmount,
      difference: e.difference,
      isMatch: e.isMatch,
      createdAt: e.createdAt,
      bankTransaction: {
        transactionDate: e.bankTransaction.transactionDate,
        description: e.bankTransaction.description,
        amount: e.bankTransaction.amount,
      },
    }),
  );

  // Update the reconciliation with entry info.
  const fullRec = {
    ...updated,
    reconciliationEntries: entriesSummary,
  };

  return toSummary(fullRec);
}

/**
 * Lock a completed reconciliation.
 */
export async function lockReconciliation(
  scope: LedgerScope,
  reconciliationId: string,
  reason: string,
): Promise<ReconciliationSummary> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }
  if (rec.status === "LOCKED") {
    return toSummary(rec);
  }
  if (rec.status !== "COMPLETED") {
    throw new ReconciliationError(
      `cannot lock reconciliation ${reconciliationId}: status is ${rec.status}, must be COMPLETED`,
      "BANKING_RECONCILIATION_LOCK_FAILED",
    );
  }

  const updated = await prisma.reconciliation.update({
    where: { id: rec.id },
    data: {
      status: "LOCKED" as Prisma.EnumReconciliationStatus,
      memo: `[LOCKED] ${reason}`,
    },
  });

  return toSummary(updated);
}

/**
 * Unlock a locked reconciliation back to DRAFT for correction.
 */
export async function unlockReconciliation(
  scope: LedgerScope,
  reconciliationId: string,
  reason: string,
): Promise<ReconciliationSummary> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }
  if (rec.status !== "LOCKED") {
    throw new ReconciliationError(
      `cannot unlock reconciliation ${reconciliationId}: status is ${rec.status}, must be LOCKED`,
      "BANKING_RECONCILIATION_UNLOCK_FAILED",
    );
  }

  const updated = await prisma.reconciliation.update({
    where: { id: rec.id },
    data: {
      status: "DRAFT" as Prisma.EnumReconciliationStatus,
      memo: `[UNLOCKED] ${reason}`,
    },
  });

  return toSummary(updated);
}

/**
 * Get all entries in a reconciliation.
 */
export async function getReconciliationEntries(
  scope: LedgerScope,
  reconciliationId: string,
): Promise<ReconciliationEntrySummary[]> {
  const rec = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId: scope.organizationId },
  });
  if (rec === null) {
    throw new ReconciliationNotFoundError(reconciliationId);
  }

  const entries = await prisma.reconciliationEntry.findMany({
    where: { reconciliationId },
    include: {
      bankTransaction: {
        select: {
          transactionDate: true,
          description: true,
          amount: true,
        },
      },
    },
    orderBy: { bankTransaction: { transactionDate: "asc" } },
  });

  return entries.map((entry) => toEntrySummary(entry, entry.bankTransaction));
}

import { Prisma } from "@prisma/client";
// NOTE: prisma, TxClient, withTx, NotFoundError, LedgerScope, and
// BankAccountNotFoundError are unused because all service functions are
// commented out (bankAccount/bankTransaction/bankFeedRule models missing
// from schema.prisma). Kept for when migration is applied.
// import { prisma } from "../../server/db/client";
// import type { TxClient } from "../../server/db/client";
// import { withTx } from "../../server/tx/with-tx";
// import { NotFoundError } from "../ledger/errors";
// import type { LedgerScope } from "../ledger/scope";
// import { BankAccountNotFoundError } from "./bank-accounts";

// ── Types ───────────────────────────────────────────────────────────────

export type TransactionType = "CREDIT" | "DEBIT";
export type TransactionStatus =
  | "UNMATCHED"
  | "MATCHED"
  | "MANUALLY_ADJUSTED"
  | "RECONCILED"
  | "FLAGGED";

export interface ImportTransactionsInput {
  externalId?: string;
  transactionDate: Date;
  postingDate?: Date;
  description: string;
  amount: string | number;
  currency?: string;
  fxRate?: string | number;
  balanceAfter?: string | number;
  type?: TransactionType;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ListTransactionFilters {
  from?: Date;
  to?: Date;
  status?: TransactionStatus;
  category?: string;
  search?: string;
}

export interface TransactionSummary {
  id: string;
  bankAccountId: string;
  externalId: string | null;
  transactionDate: Date;
  description: string;
  amount: string;
  currency: string;
  type: string;
  category: string | null;
  status: string;
  memo: string | null;
  matchingJournalLineId: string | null;
  createdAt: Date;
}

function _toSummary(row: {
  id: string;
  organizationId: string;
  bankAccountId: string;
  externalId: string | null;
  transactionDate: Date;
  postingDate: Date | null;
  description: string;
  amount: Prisma.Decimal;
  currency: string;
  fxRate: Prisma.Decimal;
  balanceAfter: Prisma.Decimal | null;
  type: string;
  category: string | null;
  matchingJournalLineId: string | null;
  status: string;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TransactionSummary {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    externalId: row.externalId,
    transactionDate: row.transactionDate,
    description: row.description,
    amount: row.amount.toFixed(4),
    currency: row.currency,
    type: row.type,
    category: row.category,
    status: row.status,
    memo: row.memo,
    matchingJournalLineId: row.matchingJournalLineId,
    createdAt: row.createdAt,
  };
}

// ── Errors ──────────────────────────────────────────────────────────────

export class BankTransactionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class TransactionNotFoundError extends BankTransactionError {
  constructor(id: string) {
    super(`transaction ${id} not found`, "BANKING_TRANSACTION_NOT_FOUND");
  }
}

// Service functions: commented out — BankAccount/BankTransaction/BankFeedRule models missing from schema.prisma
// // Service functions: commented out — BankAccount/BankTransaction/BankFeedRule models missing from schema.prisma
// /*
// // ── Service functions ───────────────────────────────────────────────────
// 
// /**
//  * Bulk import transactions from a bank feed or CSV.
//  *
//  * - Skips duplicates (same organizationId + externalId).
//  * - Applies categorization rules in priority order.
//  * - Returns summary counts.
//  */
// export async function importTransactions(
//   scope: LedgerScope,
//   bankAccountId: string,
//   transactions: ImportTransactionsInput[],
// ): Promise<ImportResult> {
//   const account = await prisma.bankAccount.findFirst({
//     where: { id: bankAccountId, organizationId: scope.organizationId },
//   });
//   if (account === null) {
//     throw new BankAccountNotFoundError(bankAccountId);
//   }
// 
//   const currency = account.currency;
//   const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
//   const createdIds: string[] = [];
// 
//   for (const tx of transactions) {
//     try {
//       if (tx.externalId !== null && tx.externalId !== "") {
//         const existing = await prisma.bankTransaction.findFirst({
//           where: {
//             organizationId: scope.organizationId,
//             externalId: tx.externalId,
//           },
//           select: { id: true },
//         });
//         if (existing) {
//           result.skipped++;
//           continue;
//         }
//       }
// 
//       const type = tx.type ?? "DEBIT";
//       const created = await prisma.bankTransaction.create({
//         data: {
//           organizationId: scope.organizationId,
//           bankAccountId,
//           externalId: tx.externalId ?? null,
//           transactionDate: tx.transactionDate,
//           postingDate: tx.postingDate ?? null,
//           description: tx.description,
//           amount: new Prisma.Decimal(tx.amount),
//           currency,
//           fxRate: tx.fxRate
//             ? new Prisma.Decimal(tx.fxRate)
//             : new Prisma.Decimal(1),
//           balanceAfter:
//             tx.balanceAfter !== undefined
//               ? new Prisma.Decimal(tx.balanceAfter)
//               : null,
//           type: type as Prisma.EnumTransactionType,
//           status: "UNMATCHED" as Prisma.EnumTransactionStatus,
//           memo: null,
//         },
//         select: { id: true },
//       });
// 
//       createdIds.push(created.id);
//       result.imported++;
//     } catch (e) {
//       result.errors.push(
//         `Failed to import transaction "${tx.description}": ${e instanceof Error ? e.message : String(e)}`,
//       );
//     }
//   }
// 
//   if (createdIds.length > 0) {
//     await _applyRulesToTransactions(scope, createdIds, bankAccountId);
//   }
// 
//   return result;
// }
// 
// export async function getBankTransaction(
//   scope: LedgerScope,
//   transactionId: string,
// ): Promise<TransactionSummary | null> {
//   const row = await prisma.bankTransaction.findFirst({
//     where: { id: transactionId, organizationId: scope.organizationId },
//   });
//   return row === null ? null : _toSummary(row);
// }
// 
// export async function listBankTransactions(
//   scope: LedgerScope,
//   bankAccountId: string,
//   options?: { filters?: ListTransactionFilters },
// ): Promise<TransactionSummary[]> {
//   const where: Prisma.BankTransactionWhereInput = {
//     organizationId: scope.organizationId,
//     bankAccountId,
//     ...(options?.filters?.from !== undefined
//       ? { transactionDate: { gte: options.filters.from } }
//       : {}),
//     ...(options?.filters?.to !== undefined
//       ? { transactionDate: { lte: options.filters.to } }
//       : {}),
//     ...(options?.filters?.status !== undefined
//       ? { status: options.filters.status as Prisma.EnumTransactionStatus }
//       : {}),
//     ...(options?.filters?.category !== undefined
//       ? { category: options.filters.category }
//       : {}),
//     ...(options?.filters?.search !== undefined
//       ? {
//           description: {
//             contains: options.filters.search,
//             mode: "insensitive",
//           },
//         }
//       : {}),
//   };
// 
//   const rows = await prisma.bankTransaction.findMany({
//     where,
//     orderBy: { transactionDate: "desc" },
//   });
//   return rows.map(_toSummary);
// }
// 
// export async function matchTransaction(
//   scope: LedgerScope,
//   transactionId: string,
//   journalEntryId: string,
// ): Promise<TransactionSummary> {
//   const tx = await prisma.bankTransaction.findFirst({
//     where: { id: transactionId, organizationId: scope.organizationId },
//   });
//   if (tx === null) {
//     throw new TransactionNotFoundError(transactionId);
//   }
// 
//   const updated = await prisma.bankTransaction.update({
//     where: { id: tx.id },
//     data: {
//       matchingJournalLineId: journalEntryId || null,
//       status: "MATCHED" as Prisma.EnumTransactionStatus,
//     },
//   });
// 
//   return _toSummary(updated);
// }
// 
// /**
//  * Create a journal entry from an unmatched bank transaction.
//  *
//  * Dr/Cr the bank account, and the offset goes to a suggested category account.
//  */
// export async function createTransactionFromMatch(
//   scope: LedgerScope,
//   transactionId: string,
//   input?: {
//     description?: string;
//     category?: string;
//     journalEntryId?: string;
//   },
// ): Promise<{ entryId: string; journalNumber: number | null }> {
//   const tx = await prisma.bankTransaction.findFirst({
//     where: { id: transactionId, organizationId: scope.organizationId },
//     include: { bankAccount: { select: { id: true, currency: true } } },
//   });
//   if (tx === null) {
//     throw new TransactionNotFoundError(transactionId);
//   }
// 
//   if (input?.journalEntryId) {
//     await prisma.bankTransaction.update({
//       where: { id: tx.id },
//       data: { status: "MANUALLY_ADJUSTED" as Prisma.EnumTransactionStatus },
//     });
//     return { entryId: input.journalEntryId, journalNumber: null };
//   }
// 
//   const decAmount = new Prisma.Decimal(tx.amount).abs();
//   const isCredit = tx.type === "CREDIT";
// 
//   const offsetAccount = await prisma.account.findFirst({
//     where: {
//       organizationId: scope.organizationId,
//       name: { contains: tx.category ?? "", mode: "insensitive" },
//     },
//     select: { id: true },
//   });
// 
//   if (offsetAccount === null) {
//     const acctType = isCredit ? "INCOME" : "EXPENSE";
//     const fallback = await prisma.account.findFirst({
//       where: {
//         organizationId: scope.organizationId,
//         type: acctType as Prisma.EnumAccountType,
//       },
//       select: { id: true },
//     });
//     if (fallback === null) {
//       throw new NotFoundError(
//         `no offset account found for category "${tx.category ?? "unknown"}"`,
//       );
//     }
//     offsetAccount.id = fallback.id;
//   }
// 
//   const period = await prisma.period.findFirst({
//     where: {
//       organizationId: scope.organizationId,
//       startDate: { lte: tx.transactionDate },
//       endDate: { gte: tx.transactionDate },
//     },
//     select: { id: true },
//   });
//   if (period === null) {
//     throw new NotFoundError(
//       `no period covers transaction date ${tx.transactionDate.toISOString().slice(0, 10)}`,
//     );
//   }
// 
//   const posted = await withTx(async (txClient) => {
//     const journalNumber = await _nextJournalNumber(
//       txClient,
//       scope.organizationId,
//       period.id,
//     );
// 
//     const entry = await txClient.journalEntry.create({
//       data: {
//         organizationId: scope.organizationId,
//         periodId: period.id,
//         entryDate: tx.transactionDate,
//         description: input?.description ?? tx.description,
//         currency: tx.currency,
//         sourceModule: "banking",
//         sourceId: tx.id,
//       },
//     });
// 
//     await txClient.journalLine.createMany({
//       data: [
//         {
//           organizationId: scope.organizationId,
//           journalEntryId: entry.id,
//           accountId: tx.bankAccount.id,
//           lineNumber: 1,
//           debit: isCredit ? "0" : decAmount.toString(),
//           credit: isCredit ? decAmount.toString() : "0",
//           currency: tx.currency,
//           fxRate: new Prisma.Decimal(tx.fxRate),
//           reportingAmount: decAmount.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
//           memo: tx.memo ?? null,
//         },
//         {
//           organizationId: scope.organizationId,
//           journalEntryId: entry.id,
//           accountId: offsetAccount.id,
//           lineNumber: 2,
//           debit: isCredit ? decAmount.toString() : "0",
//           credit: isCredit ? "0" : decAmount.toString(),
//           currency: tx.currency,
//           fxRate: new Prisma.Decimal(1),
//           reportingAmount: decAmount.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
//           memo: `Category: ${tx.category ?? "auto"}`,
//         },
//       ],
//     });
// 
//     await txClient.journalEntry.update({
//       where: { id: entry.id },
//       data: { postedAt: new Date(), postedBy: scope.userId, journalNumber },
//     });
// 
//     await txClient.bankTransaction.update({
//       where: { id: tx.id },
//       data: {
//         status: "MATCHED" as Prisma.EnumTransactionStatus,
//         matchingJournalLineId: entry.id,
//       },
//     });
// 
//     return { entryId: entry.id, journalNumber };
//   });
// 
//   return posted;
// }
// 
// /**
//  * Auto-match unmatched transactions against existing journal entries.
//  *
//  * Heuristics (in order):
//  * 1. Exact amount + exact date match
//  * 2. Amount within tolerance (0.01) + date within 3 days
//  * 3. Description substring match (fuzzy)
//  */
// export async function autoMatchTransactions(
//   scope: LedgerScope,
//   bankAccountId: string,
//   from?: Date,
//   to?: Date,
// ): Promise<{ matched: number; skipped: number }> {
//   const where: Prisma.BankTransactionWhereInput = {
//     organizationId: scope.organizationId,
//     bankAccountId,
//     status: "UNMATCHED" as Prisma.EnumTransactionStatus,
//     ...(from !== undefined || to !== undefined
//       ? {
//           transactionDate: {
//             ...(from !== undefined ? { gte: from } : {}),
//             ...(to !== undefined ? { lte: to } : {}),
//           },
//         }
//       : {}),
//   };
// 
//   const transactions = await prisma.bankTransaction.findMany({
//     where,
//   });
// 
//   let matched = 0;
//   let skipped = 0;
// 
//   for (const tx of transactions) {
//     const matchedEntry = await _findMatchingJournalEntry(scope, tx);
//     if (matchedEntry !== null) {
//       await prisma.bankTransaction.update({
//         where: { id: tx.id },
//         data: {
//           status: "MATCHED" as Prisma.EnumTransactionStatus,
//           matchingJournalLineId: matchedEntry,
//         },
//       });
//       matched++;
//     } else {
//       skipped++;
//     }
//   }
// 
//   return { matched, skipped };
// }
// 
// async function _findMatchingJournalEntry(
//   scope: LedgerScope,
//   tx: {
//     id: string;
//     amount: Prisma.Decimal;
//     transactionDate: Date;
//     description: string;
//     type: string;
//   },
// ): Promise<string | null> {
//   // Heuristic 1: exact amount + exact date
//   const lines = await prisma.journalLine.findMany({
//     where: {
//       organizationId: scope.organizationId,
//       journalEntry: {
//         postedAt: { not: null },
//         entryDate: { equals: tx.transactionDate },
//       },
//     },
//     include: {
//       journalEntry: { select: { id: true } },
//     },
//   });
// 
//   for (const line of lines) {
//     const expectedAmount =
//       tx.type === "CREDIT" ? line.credit : line.debit;
//     if (expectedAmount.equals(tx.amount.abs())) {
//       return line.journalEntry.id;
//     }
//   }
// 
//   // Heuristic 2: amount within tolerance + date within 3 days
//   const tolerance = new Prisma.Decimal("0.01");
//   const threeDays = 3 * 24 * 60 * 60 * 1000;
// 
//   const fuzzyLines = await prisma.journalLine.findMany({
//     where: {
//       organizationId: scope.organizationId,
//       journalEntry: {
//         postedAt: { not: null },
//         entryDate: {
//           gte: new Date(tx.transactionDate.getTime() - threeDays),
//           lte: new Date(tx.transactionDate.getTime() + threeDays),
//         },
//       },
//     },
//     include: {
//       journalEntry: { select: { id: true } },
//     },
//   });
// 
//   for (const line of fuzzyLines) {
//     const expectedAmount =
//       tx.type === "CREDIT" ? line.credit : line.debit;
//     if (expectedAmount.sub(tx.amount.abs()).abs().lte(tolerance)) {
//       return line.journalEntry.id;
//     }
//   }
// 
//   // Heuristic 3: description fuzzy match.
//   const descLines = await prisma.journalLine.findMany({
//     where: {
//       organizationId: scope.organizationId,
//       journalEntry: {
//         postedAt: { not: null },
//         description: {
//           contains: tx.description.slice(0, 20),
//           mode: "insensitive",
//         },
//       },
//     },
//     include: {
//       journalEntry: { select: { id: true } },
//     },
//   });
// 
//   for (const line of descLines) {
//     const expectedAmount =
//       tx.type === "CREDIT" ? line.credit : line.debit;
//     if (expectedAmount.equals(tx.amount.abs())) {
//       return line.journalEntry.id;
//     }
//   }
// 
//   return null;
// }
// 
// /**
//  * Flag a transaction for review.
//  */
// export async function flagTransaction(
//   scope: LedgerScope,
//   transactionId: string,
//   reason: string,
// ): Promise<TransactionSummary> {
//   const tx = await prisma.bankTransaction.findFirst({
//     where: { id: transactionId, organizationId: scope.organizationId },
//   });
//   if (tx === null) {
//     throw new TransactionNotFoundError(transactionId);
//   }
// 
//   const updated = await prisma.bankTransaction.update({
//     where: { id: tx.id },
//     data: { status: "FLAGGED" as Prisma.EnumTransactionStatus, memo: reason },
//   });
// 
//   return _toSummary(updated);
// }
// 
// // ── Private helpers ─────────────────────────────────────────────────────
// 
// async function _applyRulesToTransactions(
//   scope: LedgerScope,
//   transactionIds: string[],
//   bankAccountId: string,
// ): Promise<void> {
//   const rules = await prisma.bankFeedRule.findMany({
//     where: {
//       organizationId: scope.organizationId,
//       isActive: true,
//       OR: [
//         { bankAccountId: null },
//         { bankAccountId },
//       ],
//     },
//     orderBy: { priority: "desc" },
//   });
// 
//   if (rules.length === 0) return;
// 
//   const txs = await prisma.bankTransaction.findMany({
//     where: {
//       id: { in: transactionIds },
//       organizationId: scope.organizationId,
//     },
//     select: { id: true, description: true },
//   });
// 
//   for (const tx of txs) {
//     let category = tx.description;
//     for (const rule of rules) {
//       if (!matchesCondition(tx.description, rule)) continue;
// 
//       if (rule.actionType === "CATEGORIZE") {
//         category = rule.actionTarget;
//       }
//     }
//     if (category !== tx.description) {
//       await prisma.bankTransaction.update({
//         where: { id: tx.id },
//         data: { category },
//       });
//     }
//   }
// }
// 
// function matchesCondition(
//   value: string,
//   rule: {
//     conditionField: string;
//     conditionOperator: string;
//     conditionValue: string;
//   },
// ): boolean {
//   if (rule.conditionField !== "description") return false;
// 
//   switch (rule.conditionOperator) {
//     case "contains":
//       return value.toLowerCase().includes(rule.conditionValue.toLowerCase());
//     case "equals":
//       return value.toLowerCase() === rule.conditionValue.toLowerCase();
//     case "regex":
//       try {
//         const re = new RegExp(rule.conditionValue, "i");
//         return re.test(value);
//       } catch {
//         return false;
//       }
//     default:
//       return false;
//   }
// }
// 
// async function _nextJournalNumber(
//   tx: {
//     $executeRaw: (sql: TemplateStringsArray, ...params: unknown[]) => Promise<number>;
//     $queryRaw: (sql: TemplateStringsArray, ...params: unknown[]) => Promise<{ last_number: number }[]>;
//   },
//   organizationId: string,
//   periodId: string,
// ): Promise<number> {
//   await tx.$executeRaw`
//     INSERT INTO journal_counters (organization_id, period_id, last_number)
//     VALUES (${organizationId}::uuid, ${periodId}::uuid, 0)
//     ON CONFLICT (organization_id, period_id) DO NOTHING`;
// 
//   const rows = await tx.$queryRaw<{ last_number: number }[]>`
//     SELECT last_number FROM journal_counters
//     WHERE organization_id = ${organizationId}::uuid
//       AND period_id = ${periodId}::uuid
//     FOR UPDATE`;
// 
//   const current = rows[0];
//   if (current === undefined) {
//     throw new NotFoundError(
//       `journal counter for period ${periodId} could not be allocated`,
//     );
//   }
// 
//   const next = current.last_number + 1;
//   await tx.$executeRaw`
//     UPDATE journal_counters SET last_number = ${next}
//     WHERE organization_id = ${organizationId}::uuid
//       AND period_id = ${periodId}::uuid`;
//   return next;
// }
// */

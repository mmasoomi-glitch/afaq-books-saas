import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

// ── Types ───────────────────────────────────────────────────────────────

export interface BankStatementSummary {
  id: string;
  organizationId: string;
  bankAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: string;
  closingBalance: string;
  totalCredits: string;
  totalDebits: string;
  transactionCount: number;
  statementDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankStatementFilters {
  from?: Date;
  to?: Date;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class BankStatementError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class BankStatementNotFoundError extends BankStatementError {
  constructor(id: string) {
    super(`statement ${id} not found`, "BANKING_STATEMENT_NOT_FOUND");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function toSummary(row: {
  id: string;
  organizationId: string;
  bankAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBalance: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
  totalCredits: Prisma.Decimal;
  totalDebits: Prisma.Decimal;
  transactionCount: number;
  statementDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): BankStatementSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    bankAccountId: row.bankAccountId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    openingBalance: row.openingBalance.toFixed(4),
    closingBalance: row.closingBalance.toFixed(4),
    totalCredits: row.totalCredits.toFixed(4),
    totalDebits: row.totalDebits.toFixed(4),
    transactionCount: row.transactionCount,
    statementDate: row.statementDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Service functions ───────────────────────────────────────────────────

/**
 * Generate a bank statement for a bank account over a given date range.
 *
 * This is a read-only aggregation over bank transactions.
 */
export async function generateBankStatement(
  scope: LedgerScope,
  bankAccountId: string,
  filters?: BankStatementFilters,
): Promise<BankStatementSummary | null> {
  // Verify bank account belongs to this org.
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: scope.organizationId },
  });
  if (account === null) {
    throw new NotFoundError(`bank account ${bankAccountId} not found`);
  }

  const dateGte = filters?.from ?? new Date("2000-01-01");
  const dateLte = filters?.to ?? new Date("2099-12-31");

  const stmt = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(
        CASE WHEN "type" = 'CREDIT' THEN "amount" ELSE "amount" * -1 END
      ), '0') as closing,
      COALESCE(
        (SELECT SUM(
          CASE WHEN t."type" = 'CREDIT' THEN t."amount" ELSE t."amount" * -1 END
        )
        FROM "bank_transactions" t
        WHERE t."organization_id" = ${scope.organizationId}::uuid
          AND t."bank_account_id" = ${bankAccountId}::uuid
          AND t."transaction_date" < ${dateGte}
        ), '0'
      ) as opening,
      COALESCE(SUM(
        CASE WHEN "type" = 'CREDIT' AND "amount" > 0 THEN "amount" ELSE '0' END
      ), '0') as credits,
      COALESCE(SUM(
        CASE WHEN "type" = 'DEBIT' AND "amount" > 0 THEN "amount" ELSE '0' END
      ), '0') as debits,
      COUNT(*) as count,
      LEAST(
        (SELECT MIN("transaction_date") FROM "bank_transactions"
         WHERE "organization_id" = ${scope.organizationId}::uuid
           AND "bank_account_id" = ${bankAccountId}::uuid
           AND "transaction_date" BETWEEN ${dateGte} AND ${dateLte}
        ),
        ${dateGte}::timestamp
      ) as period_start,
      GREATEST(
        (SELECT MAX("transaction_date") FROM "bank_transactions"
         WHERE "organization_id" = ${scope.organizationId}::uuid
           AND "bank_account_id" = ${bankAccountId}::uuid
           AND "transaction_date" BETWEEN ${dateGte} AND ${dateLte}
        ),
        ${dateGte}::timestamp
      ) as period_end
    FROM "bank_transactions"
    WHERE "organization_id" = ${scope.organizationId}::uuid
      AND "bank_account_id" = ${bankAccountId}::uuid
      AND "transaction_date" BETWEEN ${dateGte} AND ${dateLte}
  ` as unknown as [{
    closing: Prisma.Decimal;
    opening: Prisma.Decimal;
    credits: Prisma.Decimal;
    debits: Prisma.Decimal;
    count: number;
    period_start: Date;
    period_end: Date;
  }];

  if (stmt.length === 0) {
    return null;
  }

  const row = stmt[0];
  return toSummary({
    id: "",
    organizationId: scope.organizationId,
    bankAccountId,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    openingBalance: row.opening,
    closingBalance: row.closing,
    totalCredits: row.credits,
    totalDebits: row.debits,
    transactionCount: row.count,
    statementDate: filters?.from ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Get the latest bank statement for a bank account.
 */
export async function getLatestBankStatement(
  scope: LedgerScope,
  bankAccountId: string,
): Promise<BankStatementSummary | null> {
  return generateBankStatement(scope, bankAccountId);
}

/**
 * Get all bank statements for a bank account (historical).
 */
export async function listBankStatements(
  scope: LedgerScope,
  bankAccountId: string,
  filters?: BankStatementFilters,
): Promise<BankStatementSummary[]> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: scope.organizationId },
  });
  if (account === null) {
    throw new NotFoundError(`bank account ${bankAccountId} not found`);
  }

  // For now, return a single summary. In a full implementation, this would
  // persist and query a statement_history table.
  const stmt = await generateBankStatement(scope, bankAccountId, filters);
  return stmt ? [stmt] : [];
}

/**
 * Refresh a bank statement by re-aggregating from transactions.
 * This is useful after bulk imports or manual adjustments.
 */
export async function refreshBankStatement(
  scope: LedgerScope,
  bankAccountId: string,
  from?: Date,
  to?: Date,
): Promise<BankStatementSummary | null> {
  // Verify bank account belongs to this org.
  await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, organizationId: scope.organizationId },
  });

  return generateBankStatement(scope, bankAccountId, { from, to });
}

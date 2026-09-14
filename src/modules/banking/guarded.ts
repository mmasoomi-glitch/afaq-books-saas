import { OrgScope } from "../../server/auth/scope";
import type { BankAccountSummary, CreateBankAccountInput, UpdateBankAccountInput } from "./bank-accounts";
import type {
  ImportResult,
  ImportTransactionsInput,
  TransactionSummary,
  ListTransactionFilters,
} from "./bank-transactions";
import type {
  CreateReconciliationInput,
  ReconciliationSummary,
  ReconciliationEntrySummary,
} from "./reconciliation";
import type {
  CategorizationRuleSummary,
  CreateRuleInput,
  UpdateRuleInput,
} from "./categorization-rules";
import type {
  BankStatementSummary,
  BankStatementFilters,
} from "./bank-statements";

// ── Guarded type ────────────────────────────────────────────────────────

export interface GuardedBankAccounts {
  createBankAccount(data: CreateBankAccountInput): Promise<BankAccountSummary>;
  getBankAccount(id: string): Promise<BankAccountSummary | null>;
  listBankAccounts(): Promise<BankAccountSummary[]>;
  updateBankAccount(id: string, data: UpdateBankAccountInput): Promise<BankAccountSummary>;
  deactivateBankAccount(id: string): Promise<BankAccountSummary>;
}

export interface GuardedBankTransactions {
  importTransactions(bankAccountId: string, transactions: ImportTransactionsInput[]): Promise<ImportResult>;
  getBankTransaction(id: string): Promise<TransactionSummary | null>;
  listBankTransactions(bankAccountId: string, options?: { filters?: ListTransactionFilters }): Promise<TransactionSummary[]>;
  matchTransaction(id: string, journalEntryId: string): Promise<TransactionSummary>;
  createTransactionFromMatch(id: string, input?: { description?: string; category?: string; journalEntryId?: string }): Promise<{ entryId: string; journalNumber: number | null }>;
  autoMatchTransactions(bankAccountId: string, from?: Date, to?: Date): Promise<{ matched: number; skipped: number }>;
  flagTransaction(id: string, reason: string): Promise<TransactionSummary>;
}

export interface GuardedReconciliation {
  createReconciliation(input: CreateReconciliationInput): Promise<ReconciliationSummary>;
  addTransactionToReconciliation(reconciliationId: string, transactionId: string, journalEntryId?: string): Promise<ReconciliationEntrySummary>;
  autoPopulateReconciliation(reconciliationId: string): Promise<{ added: number; matched: number }>;
  completeReconciliation(reconciliationId: string): Promise<ReconciliationSummary>;
  lockReconciliation(reconciliationId: string, reason: string): Promise<ReconciliationSummary>;
  unlockReconciliation(reconciliationId: string, reason: string): Promise<ReconciliationSummary>;
  getReconciliationEntries(reconciliationId: string): Promise<ReconciliationEntrySummary[]>;
}

export interface GuardedCategorizationRules {
  createRule(data: CreateRuleInput): Promise<CategorizationRuleSummary>;
  updateRule(id: string, data: UpdateRuleInput): Promise<CategorizationRuleSummary>;
  deleteRule(id: string): Promise<void>;
  listRules(bankAccountId?: string): Promise<CategorizationRuleSummary[]>;
  testRule(id: string, description: string): Promise<{ matches: boolean; description: string; actionType: string; actionTarget: string }>;
}

export interface GuardedBankStatements {
  generateBankStatement(bankAccountId: string, filters?: BankStatementFilters): Promise<BankStatementSummary | null>;
  getLatestBankStatement(bankAccountId: string): Promise<BankStatementSummary | null>;
  listBankStatements(bankAccountId: string, filters?: BankStatementFilters): Promise<BankStatementSummary[]>;
  refreshBankStatement(bankAccountId: string, from?: Date, to?: Date): Promise<BankStatementSummary | null>;
}

export type GuardedBankingModule = {
  "bank-accounts": GuardedBankAccounts;
  "bank-transactions": GuardedBankTransactions;
  reconciliation: GuardedReconciliation;
  "categorization-rules": GuardedCategorizationRules;
  "bank-statements": GuardedBankStatements;
};

// ── Factory ─────────────────────────────────────────────────────────────
// NOTE: All banking service functions reference Prisma models that do not
// exist in schema.prisma (bankAccount, bankTransaction, reconciliation,
// reconciliationEntry, bankFeedRule). These are WIP — the guarded wrappers
// below throw "not implemented" until the migration is applied.

export function makeGuardedBankingModule(
  _scope: OrgScope,
): GuardedBankingModule {
  throw new Error(
    "Banking module is not yet implemented: Prisma models (bankAccount, bankTransaction, " +
    "reconciliation, reconciliationEntry, bankFeedRule) are missing from schema.prisma.",
  );
}

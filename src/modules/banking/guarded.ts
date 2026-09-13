import { prisma } from "../../server/db/client";
import { OrgScope } from "../server/auth/scope";
import { assertCanDo } from "../server/auth/permissions";
import { withTx, type WithTx } from "../../server/tx/with-tx";

import * as bankAccounts from "./bank-accounts";
import * as bankTransactions from "./bank-transactions";
import * as reconciliation from "./reconciliation";
import * as categorizationRules from "./categorization-rules";
import * as bankStatements from "./bank-statements";

// ── Guarded type ────────────────────────────────────────────────────────

export type GuardedBankingModule = {
  "bank-accounts": typeof bankAccounts;
  "bank-transactions": typeof bankTransactions;
  reconciliation: typeof reconciliation;
  "categorization-rules": typeof categorizationRules;
  "bank-statements": typeof bankStatements;
};

// ── Factory ─────────────────────────────────────────────────────────────

export function makeGuardedBankingModule(
  scope: OrgScope,
): GuardedBankingModule {
  const ledgerScope = {
    organizationId: scope.organizationId,
    userId: scope.userId,
    orgId: scope.organizationId,
    role: scope.role,
    permissions: scope.permissions,
  };

  return {
    "bank-accounts": {
      async createBankAccount(data) {
        await assertCanDo(scope, "banking", "bankAccounts", "create");
        return bankAccounts.createBankAccount(ledgerScope, data);
      },
      async getBankAccount(id) {
        await assertCanDo(scope, "banking", "bankAccounts", "read");
        return bankAccounts.getBankAccount(ledgerScope, id);
      },
      async listBankAccounts() {
        await assertCanDo(scope, "banking", "bankAccounts", "read");
        return bankAccounts.listBankAccounts(ledgerScope);
      },
      async updateBankAccount(id, data) {
        await assertCanDo(scope, "banking", "bankAccounts", "update");
        return bankAccounts.updateBankAccount(ledgerScope, id, data);
      },
      async deactivateBankAccount(id) {
        await assertCanDo(scope, "banking", "bankAccounts", "update");
        return bankAccounts.deactivateBankAccount(ledgerScope, id);
      },
      async getBankAccountSummary(id) {
        await assertCanDo(scope, "banking", "bankAccounts", "read");
        return bankAccounts.getBankAccountSummary(ledgerScope, id);
      },
      async setupOpeningBalance(id, input) {
        await assertCanDo(scope, "banking", "bankAccounts", "create");
        return bankAccounts.setupOpeningBalance(ledgerScope, id, input);
      },
    },
    "bank-transactions": {
      async importTransactions(bankAccountId, transactions) {
        await assertCanDo(scope, "banking", "bankTransactions", "create");
        return bankTransactions.importTransactions(
          ledgerScope,
          bankAccountId,
          transactions,
        );
      },
      async getBankTransaction(id) {
        await assertCanDo(scope, "banking", "bankTransactions", "read");
        return bankTransactions.getBankTransaction(ledgerScope, id);
      },
      async listBankTransactions(bankAccountId, options) {
        await assertCanDo(scope, "banking", "bankTransactions", "read");
        return bankTransactions.listBankTransactions(
          ledgerScope,
          bankAccountId,
          options,
        );
      },
      async matchTransaction(id, journalEntryId) {
        await assertCanDo(scope, "banking", "bankTransactions", "update");
        return bankTransactions.matchTransaction(ledgerScope, id, journalEntryId);
      },
      async createTransactionFromMatch(id, input) {
        await assertCanDo(scope, "banking", "bankTransactions", "create");
        return bankTransactions.createTransactionFromMatch(ledgerScope, id, input);
      },
      async autoMatchTransactions(bankAccountId, from, to) {
        await assertCanDo(scope, "banking", "bankTransactions", "read");
        return bankTransactions.autoMatchTransactions(ledgerScope, bankAccountId, from, to);
      },
      async flagTransaction(id, reason) {
        await assertCanDo(scope, "banking", "bankTransactions", "update");
        return bankTransactions.flagTransaction(ledgerScope, id, reason);
      },
    },
    reconciliation: {
      async createReconciliation(input) {
        await assertCanDo(scope, "banking", "reconciliation", "create");
        return reconciliation.createReconciliation(ledgerScope, input);
      },
      async addTransactionToReconciliation(recId, txId, journalEntryId) {
        await assertCanDo(scope, "banking", "reconciliation", "update");
        return reconciliation.addTransactionToReconciliation(
          ledgerScope,
          recId,
          txId,
          journalEntryId,
        );
      },
      async autoPopulateReconciliation(recId) {
        await assertCanDo(scope, "banking", "reconciliation", "update");
        return reconciliation.autoPopulateReconciliation(ledgerScope, recId);
      },
      async completeReconciliation(recId) {
        await assertCanDo(scope, "banking", "reconciliation", "update");
        return reconciliation.completeReconciliation(ledgerScope, recId);
      },
      async lockReconciliation(recId, reason) {
        await assertCanDo(scope, "banking", "reconciliation", "update");
        return reconciliation.lockReconciliation(ledgerScope, recId, reason);
      },
      async unlockReconciliation(recId, reason) {
        await assertCanDo(scope, "banking", "reconciliation", "update");
        return reconciliation.unlockReconciliation(ledgerScope, recId, reason);
      },
      async getReconciliationEntries(recId) {
        await assertCanDo(scope, "banking", "reconciliation", "read");
        return reconciliation.getReconciliationEntries(ledgerScope, recId);
      },
    },
    "categorization-rules": {
      async createRule(data) {
        await assertCanDo(scope, "banking", "rules", "create");
        return categorizationRules.createRule(ledgerScope, data);
      },
      async updateRule(id, data) {
        await assertCanDo(scope, "banking", "rules", "update");
        return categorizationRules.updateRule(ledgerScope, id, data);
      },
      async deleteRule(id) {
        await assertCanDo(scope, "banking", "rules", "delete");
        return categorizationRules.deleteRule(ledgerScope, id);
      },
      async listRules(bankAccountId) {
        await assertCanDo(scope, "banking", "rules", "read");
        return categorizationRules.listRules(ledgerScope, bankAccountId);
      },
      async testRule(id, description) {
        await assertCanDo(scope, "banking", "rules", "read");
        return categorizationRules.testRule(id, description);
      },
    },
    "bank-statements": {
      async generateBankStatement(bankAccountId, filters) {
        await assertCanDo(scope, "banking", "statements", "read");
        return bankStatements.generateBankStatement(ledgerScope, bankAccountId, filters);
      },
      async getLatestBankStatement(bankAccountId) {
        await assertCanDo(scope, "banking", "statements", "read");
        return bankStatements.getLatestBankStatement(ledgerScope, bankAccountId);
      },
      async listBankStatements(bankAccountId, filters) {
        await assertCanDo(scope, "banking", "statements", "read");
        return bankStatements.listBankStatements(ledgerScope, bankAccountId, filters);
      },
      async refreshBankStatement(bankAccountId, from, to) {
        await assertCanDo(scope, "banking", "statements", "read");
        return bankStatements.refreshBankStatement(ledgerScope, bankAccountId, from, to);
      },
    },
  };
}

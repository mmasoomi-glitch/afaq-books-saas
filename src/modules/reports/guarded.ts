import type { OrgScope } from "../../server/auth/scope.js";
import { assertCanDo, toLedgerScope } from "../../server/auth/scope.js";
import type { TrialBalanceResult } from "./trial-balance.js";
import { trialBalance } from "./trial-balance.js";
import type { ProfitAndLoss } from "./profit-and-loss.js";
import { profitAndLoss } from "./profit-and-loss.js";
import type { BalanceSheet } from "./balance-sheet.js";
import { balanceSheet } from "./balance-sheet.js";

/**
 * Authorization-gated wrappers for the financial statements.
 *
 * An independent review caught that the reports had no gate at all: a
 * `report.read` action existed in the permission matrix and was never asserted
 * anywhere, so any caller holding an organization id could read a tenant's
 * entire financial position.
 *
 * A report is a read of the whole tenant's books — every balance, every
 * account, the profit and the net worth. That makes it at least as sensitive
 * as a single write, and it gets the same treatment: assert first, delegate
 * second. Anything reachable from a request calls these, not the underlying
 * report functions.
 */

export async function guardedTrialBalance(
  scope: OrgScope,
  asOf: Date,
): Promise<TrialBalanceResult> {
  assertCanDo(scope, "report.read");
  return trialBalance(toLedgerScope(scope), asOf);
}

export async function guardedProfitAndLoss(
  scope: OrgScope,
  from: Date,
  to: Date,
): Promise<ProfitAndLoss> {
  assertCanDo(scope, "report.read");
  return profitAndLoss(toLedgerScope(scope), from, to);
}

export async function guardedBalanceSheet(
  scope: OrgScope,
  asOf: Date,
): Promise<BalanceSheet> {
  assertCanDo(scope, "report.read");
  return balanceSheet(toLedgerScope(scope), asOf);
}

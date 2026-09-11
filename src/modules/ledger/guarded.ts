import type { Account, Period } from "@prisma/client";
import type { OrgScope } from "../../server/auth/scope.js";
import { assertCanDo, toLedgerScope } from "../../server/auth/scope.js";
import type { CreateAccountInput, CreatePeriodInput } from "./scope.js";
import type { PostJournalInput, PostedEntry } from "./posting.js";
import {
  createAccount,
  getAccount,
  listAccounts,
} from "./accounts.js";
import {
  closePeriod,
  createPeriod,
  lockPeriod,
  unlockPeriod,
} from "./periods.js";
import { postJournalEntry, reverseJournalEntry } from "./posting.js";

/**
 * Authorization-gated wrappers around the ledger services.
 *
 * The services in accounts.ts, periods.ts and posting.ts take a LedgerScope —
 * an organization id and an actor id — and trust it. That is correct for them:
 * they are the layer that enforces accounting invariants, not permissions.
 *
 * These wrappers take an OrgScope, which carries the caller's ROLE because it
 * was produced by resolveOrgScope from a verified membership, and assert the
 * permission before delegating.
 *
 * The rule: anything reachable from a request goes through this module. The
 * unguarded services stay exported for callers that already hold a verified
 * scope — one ledger service calling another, a migration, a background job —
 * where re-checking a permission that was already checked would be noise.
 *
 * Each wrapper asserts FIRST and delegates SECOND, so a refused call never
 * reaches the database at all.
 */

export async function guardedCreateAccount(
  scope: OrgScope,
  input: CreateAccountInput,
): Promise<Account> {
  assertCanDo(scope, "ledger.account.create");
  return createAccount(toLedgerScope(scope), input);
}

export async function guardedListAccounts(scope: OrgScope): Promise<Account[]> {
  assertCanDo(scope, "ledger.account.read");
  return listAccounts(toLedgerScope(scope));
}

export async function guardedGetAccount(
  scope: OrgScope,
  accountId: string,
): Promise<Account | null> {
  assertCanDo(scope, "ledger.account.read");
  return getAccount(toLedgerScope(scope), accountId);
}

export async function guardedCreatePeriod(
  scope: OrgScope,
  input: CreatePeriodInput,
): Promise<Period> {
  assertCanDo(scope, "ledger.period.create");
  return createPeriod(toLedgerScope(scope), input);
}

export async function guardedClosePeriod(
  scope: OrgScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  assertCanDo(scope, "ledger.period.close");
  return closePeriod(toLedgerScope(scope), periodId, reason);
}

export async function guardedLockPeriod(
  scope: OrgScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  assertCanDo(scope, "ledger.period.lock");
  return lockPeriod(toLedgerScope(scope), periodId, reason);
}

export async function guardedUnlockPeriod(
  scope: OrgScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  assertCanDo(scope, "ledger.period.unlock");
  return unlockPeriod(toLedgerScope(scope), periodId, reason);
}

export async function guardedPostJournalEntry(
  scope: OrgScope,
  input: PostJournalInput,
): Promise<PostedEntry> {
  assertCanDo(scope, "ledger.post");
  return postJournalEntry(toLedgerScope(scope), input);
}

export async function guardedReverseJournalEntry(
  scope: OrgScope,
  originalId: string,
  asOfDate: Date,
): Promise<PostedEntry> {
  assertCanDo(scope, "ledger.reverse");
  return reverseJournalEntry(toLedgerScope(scope), originalId, asOfDate);
}

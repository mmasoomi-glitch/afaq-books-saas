import type { Account, Period } from "@prisma/client";
import type { OrgScope } from "../../server/auth/scope";
import { assertCanDo, toLedgerScope } from "../../server/auth/scope";
import type { CreateAccountInput, CreatePeriodInput } from "./scope";
import type {
  JournalPage,
  JournalPageOptions,
  PostJournalInput,
  PostedEntry,
} from "./posting";
import { createAccount, getAccount, listAccounts } from "./accounts";
import {
  closePeriod,
  createPeriod,
  lockPeriod,
  unlockPeriod,
  listPeriods,
} from "./periods";
import { postJournalEntry, reverseJournalEntry, listEntries } from "./posting";

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
  reason: string,
): Promise<PostedEntry> {
  assertCanDo(scope, "ledger.reverse");
  return reverseJournalEntry(
    toLedgerScope(scope),
    originalId,
    asOfDate,
    reason,
  );
}

export async function guardedListEntries(
  scope: OrgScope,
  options?: JournalPageOptions,
): Promise<JournalPage> {
  // `report.read`, not a new key. The journal IS a report — it is the most
  // direct view of the posted ledger there is — and anyone who may read the
  // trial balance can already derive every number in it.
  assertCanDo(scope, "report.read");
  return listEntries(toLedgerScope(scope), options ?? {});
}

export async function guardedListPeriods(scope: OrgScope): Promise<Period[]> {
  // `ledger.account.read` rather than a new action key. Reading the period list
  // is the same class of thing as reading the chart — it is structural
  // information about the books, not their contents — and inventing a second
  // key for it would mean two places to remember when a role changes.
  assertCanDo(scope, "ledger.account.read");
  return listPeriods(toLedgerScope(scope));
}

/**
 * The input types, re-exported so callers never have to reach past this module.
 *
 * The CI gate that keeps the unguarded services private cannot distinguish
 * `import type` from `import`, and it should not try: a type-only import today
 * is one character away from a value import tomorrow, and the gate would have
 * to be loosened to allow the first before it could be tightened again.
 *
 * So `guarded.ts` is the complete public surface of this module — the functions
 * AND the shapes they take. Nothing outside it needs to know that `posting.ts`
 * exists.
 */
export type { CreateAccountInput, CreatePeriodInput } from "./scope";
export type {
  AccountTotals,
  EntrySummary,
  EntrySummaryLine,
  JournalFilter,
  JournalPage,
  JournalPageOptions,
  PostJournalInput,
  PostLineInput,
  PostedEntry,
} from "./posting";

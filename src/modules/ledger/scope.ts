/**
 * Every ledger service takes a LedgerScope as its FIRST argument and filters
 * every query by scope.organizationId.
 *
 * AUTH-TENANCY will later derive this from an authenticated session plus the
 * org slug in the URL. Until then the caller constructs it. A service must
 * NEVER accept an organization id from caller-supplied input data — see
 * .claude/rules/security-tenancy.md.
 */
declare const authorized: unique symbol;

/**
 * A scope that has been through an authorization check.
 *
 * The `authorized` brand is a phantom property: it exists in the type and never
 * at runtime. Its whole purpose is that a plain object literal
 * `{ userId, organizationId }` is NO LONGER assignable to LedgerScope, so a
 * future module cannot accidentally hand the ledger services a scope it
 * invented — it will not compile.
 *
 * Be precise about what this does and does not buy. It makes ACCIDENTAL bypass
 * impossible. It does not make deliberate bypass impossible: anyone can call
 * `unsafeCreateLedgerScope` below. That function is named to be conspicuous in
 * review and greppable in CI, which is the honest limit of what a type can
 * enforce. See B-20260911-05.
 */
export interface LedgerScope {
  readonly userId: string;
  readonly organizationId: string;
  readonly [authorized]: true;
}

/**
 * The ONLY way to construct a LedgerScope.
 *
 * Legitimate callers: `toLedgerScope` in src/server/auth/scope.ts, which has
 * just verified a membership, and test fixtures. Anything else calling this is
 * asserting "I have already checked authorization myself", and the name is
 * deliberately ugly so that claim is visible in a diff.
 */
export function unsafeCreateLedgerScope(
  userId: string,
  organizationId: string,
): LedgerScope {
  return { userId, organizationId } as unknown as LedgerScope;
}

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  parentId?: string;
}

export interface CreatePeriodInput {
  name: string;
  startDate: Date;
  endDate: Date;
}

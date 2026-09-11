/**
 * Every ledger service takes a LedgerScope as its FIRST argument and filters
 * every query by scope.organizationId.
 *
 * AUTH-TENANCY will later derive this from an authenticated session plus the
 * org slug in the URL. Until then the caller constructs it. A service must
 * NEVER accept an organization id from caller-supplied input data — see
 * .claude/rules/security-tenancy.md.
 */
export interface LedgerScope {
  readonly userId: string;
  readonly organizationId: string;
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

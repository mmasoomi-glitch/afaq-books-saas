import type { MembershipRole } from "@prisma/client";

export type Action =
  | "ledger.account.create"
  | "ledger.account.read"
  | "ledger.period.create"
  | "ledger.period.close"
  | "ledger.period.lock"
  | "ledger.period.unlock"
  | "ledger.post"
  | "ledger.reverse"
  | "report.read"
  | "member.invite"
  | "member.remove"
  | "role.grant";

const VIEWER_ACTIONS: readonly Action[] = [
  "ledger.account.read",
  "report.read",
];

const BOOKKEEPER_ACTIONS: readonly Action[] = [
  ...VIEWER_ACTIONS,
  "ledger.account.create",
  "ledger.period.create",
  "ledger.post",
  "ledger.reverse",
];

const APPROVER_ACTIONS: readonly Action[] = [...BOOKKEEPER_ACTIONS];

const ACCOUNTANT_ACTIONS: readonly Action[] = [
  ...APPROVER_ACTIONS,
  "ledger.period.close",
];

const ADMIN_ACTIONS: readonly Action[] = [
  ...ACCOUNTANT_ACTIONS,
  "ledger.period.lock",
  "ledger.period.unlock",
  "member.invite",
  "role.grant",
];

const OWNER_ACTIONS: readonly Action[] = [...ADMIN_ACTIONS, "member.remove"];

export const ROLE_ACTIONS: Record<MembershipRole, readonly Action[]> = {
  VIEWER: VIEWER_ACTIONS,
  BOOKKEEPER: BOOKKEEPER_ACTIONS,
  APPROVER: APPROVER_ACTIONS,
  ACCOUNTANT: ACCOUNTANT_ACTIONS,
  ADMIN: ADMIN_ACTIONS,
  OWNER: OWNER_ACTIONS,
};

export function can(role: MembershipRole, action: Action): boolean {
  const allowed = ROLE_ACTIONS[role];
  if (allowed === undefined) return false;
  return allowed.includes(action);
}

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
  | "audit.read"
  | "member.read"
  | "member.invite"
  | "member.remove"
  | "role.grant"
  | "ownership.transfer";

/**
 * `member.read` sits with VIEWER deliberately. Knowing who else is in an
 * organization is not privileged information to someone already inside it —
 * they see those people's postings in the audit trail either way — and hiding
 * it would mean a bookkeeper could not tell who to ask about an entry.
 *
 * It is still an ACTION rather than something every member gets implicitly, so
 * that a future role below VIEWER (an external auditor, a read-only
 * integration) can be denied it without touching any call site.
 */
const VIEWER_ACTIONS: readonly Action[] = [
  "ledger.account.read",
  "report.read",
  "member.read",
];

const BOOKKEEPER_ACTIONS: readonly Action[] = [
  ...VIEWER_ACTIONS,
  "ledger.account.create",
  "ledger.period.create",
  "ledger.post",
  "ledger.reverse",
];

const APPROVER_ACTIONS: readonly Action[] = [...BOOKKEEPER_ACTIONS];

/**
 * `audit.read` sits with ACCOUNTANT, not ADMIN, because
 * `security-tenancy.md` says the trail must be "queryable by an authorized
 * ACCOUNTANT for the trailing audit window" — that is the person whose job it
 * is to read it.
 *
 * It is deliberately NOT a VIEWER action. The trail contains membership grants
 * and role changes, which is organizational rather than financial information,
 * and a bookkeeper does not need to know who was promoted last quarter to do
 * their work.
 */
const ACCOUNTANT_ACTIONS: readonly Action[] = [
  ...APPROVER_ACTIONS,
  "ledger.period.close",
  "audit.read",
];

const ADMIN_ACTIONS: readonly Action[] = [
  ...ACCOUNTANT_ACTIONS,
  "ledger.period.lock",
  "ledger.period.unlock",
  "member.invite",
  "role.grant",
];

/**
 * `ownership.transfer` is OWNER-only and is deliberately NOT reachable through
 * `role.grant`. Promoting a co-owner and handing over an organization are
 * different intentions; keeping them apart is what lets the audit trail say
 * which one happened, and it is the reason `assertGrantable` refuses OWNER from
 * every caller including another owner.
 */
const OWNER_ACTIONS: readonly Action[] = [
  ...ADMIN_ACTIONS,
  "member.remove",
  "ownership.transfer",
];

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

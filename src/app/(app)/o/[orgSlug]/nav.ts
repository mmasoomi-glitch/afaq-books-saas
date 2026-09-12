import type { MembershipRole } from "@prisma/client";
import type { Action } from "../../../../server/auth/permissions";
import { can } from "../../../../server/auth/permissions";

/**
 * Which destinations exist, and what each one requires.
 *
 * Deliberately a plain module with no `next/` import, so it can be unit-tested.
 * Left inside `layout.tsx` this table would be reachable only by rendering a
 * React server component, and there is no jsdom environment configured — which
 * in practice means it would never have been tested at all.
 *
 * One table, rather than a link list per page. The three report pages each
 * carried their own copy before this, which is how one of them ends up missing
 * a link nobody notices, and how a link outlives the page it points at.
 */

export interface NavLink {
  readonly href: string;
  readonly label: string;
}

export interface NavEntry {
  readonly label: string;
  /** Relative to `/o/{slug}`, with no leading slash. `""` would be the org root. */
  readonly segment: string;
  /**
   * The permission the DESTINATION asserts — the same key, not a parallel one.
   *
   * Naming the identical action is what keeps the nav and the page from
   * drifting: changing which role may read the audit trail is one edit in
   * `permissions.ts`, and this follows without anybody remembering to update it.
   */
  readonly action: Action;
}

export const NAV: readonly NavEntry[] = [
  {
    label: "Chart of accounts",
    segment: "accounts",
    action: "ledger.account.read",
  },
  { label: "Periods", segment: "periods", action: "ledger.account.read" },
  { label: "New entry", segment: "entries/new", action: "ledger.post" },
  { label: "Journal", segment: "entries", action: "report.read" },
  {
    label: "Trial balance",
    segment: "reports/trial-balance",
    action: "report.read",
  },
  {
    label: "Profit and loss",
    segment: "reports/profit-and-loss",
    action: "report.read",
  },
  {
    label: "Balance sheet",
    segment: "reports/balance-sheet",
    action: "report.read",
  },
  { label: "Members", segment: "members", action: "member.read" },
  { label: "Audit trail", segment: "audit", action: "audit.read" },
];

/**
 * The links this role should be offered.
 *
 * **This is not authorization, and must never be read as it.** Every
 * destination re-checks its own permission server-side and refuses a caller who
 * lacks it, whether or not a link was ever drawn. Typing the URL, keeping an old
 * bookmark, or calling the API directly all meet the same check.
 *
 * The filter exists because an interface that offers an action and then refuses
 * it is an interface that lied. Showing a VIEWER an "Audit trail" link that
 * answers 403 tells them they hold a permission they do not, and the only way
 * they find out is by being rejected.
 */
export function navLinksFor(
  role: MembershipRole,
  orgSlug: string,
): readonly NavLink[] {
  return NAV.filter((entry) => can(role, entry.action)).map((entry) => ({
    href: `/o/${orgSlug}/${entry.segment}`,
    label: entry.label,
  }));
}

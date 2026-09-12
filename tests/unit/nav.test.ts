import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MembershipRole } from "@prisma/client";
import { expect, test } from "vitest";
import { NAV, navLinksFor } from "../../src/app/(app)/o/[orgSlug]/nav";
import { ROLE_ACTIONS } from "../../src/server/auth/permissions";

/**
 * The navigation table.
 *
 * Extracted from `layout.tsx` precisely so these can exist: there is no jsdom
 * environment configured, so anything reachable only by rendering a React
 * component is in practice untested. The table is the part with decisions in
 * it; the JSX around it is not.
 */

const ORG = "acme";
const APP_DIR = join(process.cwd(), "src", "app", "(app)", "o", "[orgSlug]");

function labels(role: MembershipRole): string[] {
  return navLinksFor(role, ORG).map((link) => link.label);
}

test("N1: every destination in the table is a page that exists", () => {
  // The test that earns its keep. A nav entry pointing at a route that was
  // renamed or never built is a link that 404s, and nothing else in the suite
  // would notice — the filter would happily include it for the right role.
  for (const entry of NAV) {
    const page = join(APP_DIR, ...entry.segment.split("/"), "page.tsx");
    expect(existsSync(page), `${entry.label} -> ${entry.segment}`).toBe(true);
  }
});

test("N2: a VIEWER is not offered the audit trail or a way to post", () => {
  const seen = labels("VIEWER");

  expect(seen).not.toContain("Audit trail");
  expect(seen).not.toContain("New entry");
  // But they are not left with an empty shell — reading is what the role is for.
  expect(seen).toContain("Trial balance");
  expect(seen).toContain("Chart of accounts");
});

test("N3: an ACCOUNTANT is offered the audit trail, a BOOKKEEPER is not", () => {
  // `audit.read` sits with ACCOUNTANT deliberately; the trail carries role
  // grants and membership changes, which a bookkeeper does not need to do their
  // work. This pins that the nav agrees with that decision rather than
  // approximating it.
  expect(labels("ACCOUNTANT")).toContain("Audit trail");
  expect(labels("BOOKKEEPER")).not.toContain("Audit trail");
  expect(labels("BOOKKEEPER")).toContain("New entry");
});

test("N4: a higher role is never offered LESS than a lower one", () => {
  // The roles are defined as nested action sets, and the nav derives from them.
  // If this ever fails, either the nesting broke or the nav stopped deriving —
  // both of which would otherwise show up as a missing link somebody blames on
  // the UI.
  const ladder: readonly MembershipRole[] = [
    "VIEWER",
    "BOOKKEEPER",
    "APPROVER",
    "ACCOUNTANT",
    "ADMIN",
    "OWNER",
  ];

  for (let i = 1; i < ladder.length; i += 1) {
    const lower = ladder[i - 1];
    const higher = ladder[i];
    if (lower === undefined || higher === undefined) continue;
    for (const label of labels(lower)) {
      expect(labels(higher), `${higher} vs ${lower}`).toContain(label);
    }
  }
});

test("N5: every link stays inside this organization's namespace", () => {
  // No link may leave `/o/{slug}/`. A nav that can point at another tenant's
  // URL is one edit away from doing so.
  for (const link of navLinksFor("OWNER", ORG)) {
    expect(link.href.startsWith(`/o/${ORG}/`)).toBe(true);
    expect(link.href).not.toContain("..");
  }
});

test("N6: the slug is interpolated, not assumed", () => {
  // Two different organizations produce two different link sets. A table that
  // hardcoded a slug would pass every other test here.
  const a = navLinksFor("OWNER", "alpha").map((l) => l.href);
  const b = navLinksFor("OWNER", "beta").map((l) => l.href);

  expect(a).not.toEqual(b);
  expect(a.every((href) => href.startsWith("/o/alpha/"))).toBe(true);
});

test("N7: hrefs are unique, because AppNav keys on them", () => {
  const hrefs = navLinksFor("OWNER", ORG).map((link) => link.href);
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

test("N8: every action the table names is a real action", () => {
  // TypeScript already requires this at the table, but the table is data and
  // data gets edited. An action string that no role holds would silently hide a
  // link from everyone — the nav would simply lose an entry with no error.
  const known = new Set(ROLE_ACTIONS.OWNER);
  for (const entry of NAV) {
    expect(known.has(entry.action), entry.label).toBe(true);
  }
});

test("N9: an OWNER sees every entry in the table", () => {
  expect(navLinksFor("OWNER", ORG)).toHaveLength(NAV.length);
});

import { expect, test } from "vitest";
import { journalHref } from "../../src/app/(app)/o/[orgSlug]/reports/drilldown";

/**
 * The drill-down URL.
 *
 * A plain module rather than logic inside the link component, for the same
 * reason the nav table is: there is no jsdom environment, so anything reachable
 * only by rendering a component is in practice untested — and the part with
 * decisions in it is the query string, not the anchor.
 */

const ORG = "acme";
const ACCOUNT = "9d0fa9a7-793f-4519-bd66-73024108e228";

function paramsOf(href: string): URLSearchParams {
  const separator = href.indexOf("?");
  return new URLSearchParams(separator === -1 ? "" : href.slice(separator + 1));
}

test("D1: a cumulative statement passes `to` and NO `from`", () => {
  // The property the whole feature rests on. A trial balance is everything up
  // to a date; adding a start would open a journal showing a SUBSET that does
  // not sum to the figure the reader clicked — which is the opposite of a
  // reconciliation.
  const params = paramsOf(
    journalHref({ orgSlug: ORG, accountId: ACCOUNT, to: "2024-01-31" }),
  );

  expect(params.get("account")).toBe(ACCOUNT);
  expect(params.get("to")).toBe("2024-01-31");
  expect(params.has("from")).toBe(false);
});

test("D2: a profit and loss passes both ends", () => {
  const params = paramsOf(
    journalHref({
      orgSlug: ORG,
      accountId: ACCOUNT,
      from: "2024-01-01",
      to: "2024-03-31",
    }),
  );

  expect(params.get("from")).toBe("2024-01-01");
  expect(params.get("to")).toBe("2024-03-31");
});

test("D3: the parameter names are the ones the journal page reads", () => {
  // A cross-module contract with nothing else enforcing it. Rename a parameter
  // on either side and the link silently stops filtering — the journal would
  // render every entry under a heading that came from one account, which looks
  // like a reconciliation failure rather than a broken link.
  const params = paramsOf(
    journalHref({
      orgSlug: ORG,
      accountId: ACCOUNT,
      from: "2024-01-01",
      to: "2024-03-31",
    }),
  );

  expect([...params.keys()].sort()).toEqual(["account", "from", "to"]);
});

test("D4: it points at the journal for the right organization", () => {
  const href = journalHref({ orgSlug: ORG, accountId: ACCOUNT });

  expect(href.startsWith(`/o/${ORG}/entries?`)).toBe(true);
});

test("D5: an empty date is omitted, not sent as an empty parameter", () => {
  // `from=` would reach `new Date("")`, which is Invalid Date — and SQL
  // compares Invalid Date against nothing, silently returning an empty journal
  // that reads as "this account has no postings".
  const params = paramsOf(
    journalHref({ orgSlug: ORG, accountId: ACCOUNT, from: "", to: "" }),
  );

  expect(params.has("from")).toBe(false);
  expect(params.has("to")).toBe(false);
  expect(params.get("account")).toBe(ACCOUNT);
});

test("D6: the slug is encoded as a path segment", () => {
  // `URLSearchParams` cannot help here — the slug is in the path. Slugs are
  // lowercase and hyphenated today, so nothing currently needs escaping; this
  // pins it so that stops being load-bearing.
  const href = journalHref({ orgSlug: "a b/c", accountId: ACCOUNT });

  expect(href.startsWith("/o/a%20b%2Fc/entries?")).toBe(true);
});

test("D7: values are encoded rather than concatenated", () => {
  const href = journalHref({
    orgSlug: ORG,
    accountId: "x&account=y",
  });

  // Round-tripping is the real assertion: an injected `&` must not become a
  // second parameter.
  const params = paramsOf(href);
  expect(params.get("account")).toBe("x&account=y");
  expect([...params.keys()]).toEqual(["account"]);
});

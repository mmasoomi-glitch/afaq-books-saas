import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser, signIn } from "../../../src/server/auth/session";
import { createOrganization } from "../../../src/server/auth/membership";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";
import type {
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../../../src/server/http/types";
import { withOrgScope } from "../../../src/server/http/handlers/scoped";
import {
  createAccountHandler,
  createPeriodHandler,
  postEntryHandler,
  reverseEntryHandler,
  transitionPeriodHandler,
} from "../../../src/server/http/handlers/ledger";
import { guardedListEntries } from "../../../src/modules/ledger/guarded";
import { resolveOrgScope } from "../../../src/server/auth/scope";

/**
 * The ledger endpoints. The services behind them are covered elsewhere; what is
 * asserted here is the part only the HTTP layer decides — which inputs are
 * refused before a query runs, and what status a refusal carries.
 */

const PASSWORD = "correct horse battery staple";
const CSRF = "csrf-token-for-tests-0123456789";

beforeEach(async () => {
  await resetDb();
});

function newSlug(): string {
  return `org-${randomUUID().slice(0, 8)}`;
}

function req(
  method: HttpMethod,
  over?: Partial<HttpRequest> & { session?: string },
): HttpRequest {
  const { session, ...rest } = over ?? {};
  return {
    method,
    path: "/",
    ...rest,
    headers: { [CSRF_HEADER]: CSRF, ...over?.headers },
    cookies: {
      [CSRF_COOKIE]: CSRF,
      ...(session === undefined ? {} : { [SESSION_COOKIE]: session }),
      ...over?.cookies,
    },
  };
}

function bodyOf(res: HttpResponse): Record<string, unknown> {
  const body = res.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`expected an object body, got ${String(body)}`);
  }
  return { ...body } as Record<string, unknown>;
}

function errorCode(res: HttpResponse): string {
  const wrapper = bodyOf(res)["error"];
  if (typeof wrapper !== "object" || wrapper === null) return "";
  const code = (wrapper as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : "";
}

async function actor(role: MembershipRole): Promise<{
  token: string;
  slug: string;
  organizationId: string;
}> {
  const email = `${randomUUID()}@example.test`;
  const { userId } = await registerUser(email, PASSWORD);
  const slug = newSlug();
  const { organizationId } = await createOrganization(userId, {
    slug,
    name: "Acme",
  });

  if (role !== "OWNER") {
    // Demote via a direct update: the service refuses to change your own role,
    // and the trigger refuses to leave no owner — so give the org a second
    // owner first, then step this one down.
    const other = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test` },
    });
    await prisma.membership.create({
      data: { userId: other.id, organizationId, role: "OWNER" },
    });
    await prisma.membership.updateMany({
      where: { userId, organizationId },
      data: { role },
    });
  }

  const { rawToken } = await signIn(email, PASSWORD);
  return { token: rawToken, slug, organizationId };
}

const VALID_ACCOUNT = {
  code: "1000",
  name: "Cash",
  type: "ASSET",
  currency: "USD",
};

test("L1: a bookkeeper can add an account", async () => {
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  const res = await withOrgScope(slug, createAccountHandler())(
    req("POST", { session: token, body: VALID_ACCOUNT }),
  );

  expect(res.status).toBe(201);
  expect(bodyOf(res)["code"]).toBe("1000");
  expect(await prisma.account.count({ where: { organizationId } })).toBe(1);
});

test("L2: a viewer cannot, and nothing is written", async () => {
  const { token, slug, organizationId } = await actor("VIEWER");

  const res = await withOrgScope(slug, createAccountHandler())(
    req("POST", { session: token, body: VALID_ACCOUNT }),
  );

  expect(res.status).toBe(403);
  expect(await prisma.account.count({ where: { organizationId } })).toBe(0);
});

test("L3: a duplicate code is 409, not 500", async () => {
  // `createAccount` lets the unique constraint do the work rather than checking
  // first, because a check-then-insert races two concurrent creations into the
  // same code. Without the mapping the violation would surface as a 500 and the
  // user would be told "something went wrong" about a five-second fix.
  const { token, slug } = await actor("BOOKKEEPER");
  const create = withOrgScope(slug, createAccountHandler());

  expect(
    (await create(req("POST", { session: token, body: VALID_ACCOUNT }))).status,
  ).toBe(201);

  const second = await create(
    req("POST", {
      session: token,
      body: { ...VALID_ACCOUNT, name: "Something else" },
    }),
  );
  expect(second.status).toBe(409);
  expect(errorCode(second)).toBe("ALREADY_EXISTS");
});

test("L4: an invented account type is 400 before any query runs", async () => {
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  for (const type of ["NONSENSE", "asset", "", "ASSETS"]) {
    const res = await withOrgScope(slug, createAccountHandler())(
      req("POST", { session: token, body: { ...VALID_ACCOUNT, type } }),
    );
    expect(res.status).toBe(400);
  }

  expect(await prisma.account.count({ where: { organizationId } })).toBe(0);
});

test("L5: a malformed currency is 400", async () => {
  // `accounts.currency` is CHAR(3). Without the shape check the driver decides
  // what happens to a longer value, and whatever it decides is not a message
  // anybody can act on.
  const { token, slug } = await actor("BOOKKEEPER");

  for (const currency of ["DOLLARS", "US", "", "U$D", "12"]) {
    const res = await withOrgScope(slug, createAccountHandler())(
      req("POST", { session: token, body: { ...VALID_ACCOUNT, currency } }),
    );
    expect(res.status).toBe(400);
  }
});

test("L6: a lowercase currency is accepted and stored upper-case", async () => {
  // Normalising rather than refusing: "usd" is not a different currency from
  // "USD", and rejecting it would be pedantry a user cannot learn from.
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  const res = await withOrgScope(slug, createAccountHandler())(
    req("POST", { session: token, body: { ...VALID_ACCOUNT, currency: "usd" } }),
  );

  expect(res.status).toBe(201);
  const account = await prisma.account.findFirstOrThrow({
    where: { organizationId },
  });
  expect(account.currency).toBe("USD");
});

test("L7: a missing field is 400 and names what is required", async () => {
  const { token, slug } = await actor("BOOKKEEPER");

  for (const omit of ["code", "name", "type", "currency"]) {
    const body: Record<string, unknown> = { ...VALID_ACCOUNT };
    delete body[omit];
    const res = await withOrgScope(slug, createAccountHandler())(
      req("POST", { session: token, body }),
    );
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe("INVALID_BODY");
  }
});

test("L8: an object-shaped field is rejected rather than cast", async () => {
  const { token, slug } = await actor("BOOKKEEPER");

  const res = await withOrgScope(slug, createAccountHandler())(
    req("POST", {
      session: token,
      body: { ...VALID_ACCOUNT, code: { toString: "1000" } },
    }),
  );

  expect(res.status).toBe(400);
});

test("L9: creating an account without a csrf pair is 403 and writes nothing", async () => {
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  const res = await withOrgScope(slug, createAccountHandler())({
    method: "POST",
    path: "/",
    headers: {},
    cookies: { [SESSION_COOKIE]: token },
    body: VALID_ACCOUNT,
  });

  expect(res.status).toBe(403);
  expect(errorCode(res)).toBe("CSRF_INVALID");
  expect(await prisma.account.count({ where: { organizationId } })).toBe(0);
});

test("L10: another tenant cannot add an account to your chart", async () => {
  const mine = await actor("OWNER");
  const theirs = await actor("OWNER");

  const res = await withOrgScope(mine.slug, createAccountHandler())(
    req("POST", { session: theirs.token, body: VALID_ACCOUNT }),
  );

  expect(res.status).toBe(404);
  expect(
    await prisma.account.count({ where: { organizationId: mine.organizationId } }),
  ).toBe(0);
});

test("L11: a period is created with valid dates", async () => {
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  const res = await withOrgScope(slug, createPeriodHandler())(
    req("POST", {
      session: token,
      body: { name: "2024", startDate: "2024-01-01", endDate: "2024-12-31" },
    }),
  );

  expect(res.status).toBe(201);
  expect(bodyOf(res)["status"]).toBe("OPEN");
  expect(await prisma.period.count({ where: { organizationId } })).toBe(1);
});

test("L12: an unparseable date is 400, not a constraint violation", async () => {
  // An `Invalid Date` reaches the driver as NULL or as a cast failure depending
  // on the path, and the period non-overlap EXCLUSION constraint would then
  // reject it for a reason that has nothing to do with what the user typed.
  const { token, slug, organizationId } = await actor("BOOKKEEPER");

  for (const dates of [
    { startDate: "not a date", endDate: "2024-12-31" },
    { startDate: "2024-01-01", endDate: "31/12/2024x" },
    { startDate: "", endDate: "2024-12-31" },
  ]) {
    const res = await withOrgScope(slug, createPeriodHandler())(
      req("POST", { session: token, body: { name: "2024", ...dates } }),
    );
    expect(res.status).toBe(400);
  }

  expect(await prisma.period.count({ where: { organizationId } })).toBe(0);
});

test("L13: overlapping periods are refused, surfaced not swallowed", async () => {
  // `period_no_overlap` is an EXCLUSION constraint. The handler does not
  // re-implement it — it lets the database answer and does not turn the failure
  // into a success.
  const { token, slug, organizationId } = await actor("BOOKKEEPER");
  const create = withOrgScope(slug, createPeriodHandler());

  expect(
    (
      await create(
        req("POST", {
          session: token,
          body: { name: "2024", startDate: "2024-01-01", endDate: "2024-12-31" },
        }),
      )
    ).status,
  ).toBe(201);

  await expect(
    create(
      req("POST", {
        session: token,
        body: { name: "Overlap", startDate: "2024-06-01", endDate: "2025-06-01" },
      }),
    ),
  ).rejects.toThrow();

  expect(await prisma.period.count({ where: { organizationId } })).toBe(1);
});

/** Two accounts and an open period: the minimum from which an entry can exist. */
async function ledgerReady(role: MembershipRole = "BOOKKEEPER"): Promise<{
  token: string;
  slug: string;
  organizationId: string;
  cashId: string;
  revenueId: string;
  periodId: string;
}> {
  const base = await actor(role);
  const create = withOrgScope(base.slug, createAccountHandler());

  const cash = await create(
    req("POST", { session: base.token, body: VALID_ACCOUNT }),
  );
  const revenue = await create(
    req("POST", {
      session: base.token,
      body: { code: "4000", name: "Revenue", type: "INCOME", currency: "USD" },
    }),
  );
  const period = await withOrgScope(base.slug, createPeriodHandler())(
    req("POST", {
      session: base.token,
      body: { name: "2024", startDate: "2024-01-01", endDate: "2024-12-31" },
    }),
  );

  // A period covering TODAY as well, because a reversal defaults to today and
  // is posted into whichever period covers that date. Without one, every
  // reversal here would fail for a reason that has nothing to do with what is
  // under test — which is exactly how the real behaviour was found.
  const thisYear = new Date().getFullYear();
  await withOrgScope(base.slug, createPeriodHandler())(
    req("POST", {
      session: base.token,
      body: {
        name: String(thisYear),
        startDate: `${String(thisYear)}-01-01`,
        endDate: `${String(thisYear)}-12-31`,
      },
    }),
  );

  return {
    ...base,
    cashId: String(bodyOf(cash)["id"]),
    revenueId: String(bodyOf(revenue)["id"]),
    periodId: String(bodyOf(period)["id"]),
  };
}

test("L14: a balanced entry posts and gets a journal number", async () => {
  const env = await ledgerReady();

  const res = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Sale",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "500.0000" },
          { accountId: env.revenueId, credit: "500.0000" },
        ],
      },
    }),
  );

  expect(res.status).toBe(201);
  expect(bodyOf(res)["journalNumber"]).toBe(1);
  expect(
    await prisma.journalEntry.count({
      where: { organizationId: env.organizationId, postedAt: { not: null } },
    }),
  ).toBe(1);
});

test("L15: an unbalanced entry is 422 with a reason, not 500", async () => {
  // Found by posting one against the running server: it was correctly refused
  // and answered 500 "internal error". The refusal was right and the status was
  // wrong — the caller was told nothing they could act on.
  //
  // 422 because the body was well-formed and every field had the right type;
  // what failed is a rule about the relationship BETWEEN the fields.
  const env = await ledgerReady();

  const res = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Bad",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "500" },
          { accountId: env.revenueId, credit: "499" },
        ],
      },
    }),
  );

  expect(res.status).toBe(422);
  expect(errorCode(res)).toBe("LEDGER_UNBALANCED");
  expect(await prisma.journalEntry.count()).toBe(0);
});

test("L16: a line with both or neither side is 400 before any write", async () => {
  const env = await ledgerReady();
  const post = withOrgScope(env.slug, postEntryHandler());

  const bad = [
    [
      { accountId: env.cashId, debit: "1", credit: "1" },
      { accountId: env.revenueId, credit: "1" },
    ],
    [
      { accountId: env.cashId },
      { accountId: env.revenueId, credit: "1" },
    ],
    [
      { accountId: env.cashId, debit: "1.23456" },
      { accountId: env.revenueId, credit: "1" },
    ],
    [{ accountId: env.cashId, debit: "1" }],
  ];

  for (const lines of bad) {
    const res = await post(
      req("POST", {
        session: env.token,
        body: {
          periodId: env.periodId,
          entryDate: "2024-03-01",
          description: "X",
          currency: "USD",
          lines,
        },
      }),
    );
    expect(res.status).toBe(400);
  }

  expect(await prisma.journalEntry.count()).toBe(0);
});

test("L17: amounts are never round-tripped through a float", async () => {
  // I8. `0.1 + 0.2` is the canonical example and it is exactly the arithmetic a
  // ledger cannot survive. The handler validates the string and passes it
  // through untouched for Prisma.Decimal to parse.
  const env = await ledgerReady();

  const res = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Thirds",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "0.1000" },
          { accountId: env.cashId, debit: "0.2000" },
          { accountId: env.revenueId, credit: "0.3000" },
        ],
      },
    }),
  );

  expect(res.status).toBe(201);

  const lines = await prisma.journalLine.findMany({
    where: { organizationId: env.organizationId },
    orderBy: { lineNumber: "asc" },
  });
  expect(lines.map((line) => line.debit.toFixed(4))).toEqual([
    "0.1000",
    "0.2000",
    "0.0000",
  ]);
  expect(lines[2]?.credit.toFixed(4)).toBe("0.3000");
});

test("L18: a viewer cannot post, and nothing is written", async () => {
  const env = await ledgerReady("VIEWER");

  const res = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Nope",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "1" },
          { accountId: env.revenueId, credit: "1" },
        ],
      },
    }),
  );

  expect(res.status).toBe(403);
  expect(await prisma.journalEntry.count()).toBe(0);
});

test("L19: posting into another tenant's organization is 404", async () => {
  const mine = await ledgerReady();
  const theirs = await actor("OWNER");

  const res = await withOrgScope(mine.slug, postEntryHandler())(
    req("POST", {
      session: theirs.token,
      body: {
        periodId: mine.periodId,
        entryDate: "2024-03-01",
        description: "Theft",
        currency: "USD",
        lines: [
          { accountId: mine.cashId, debit: "1" },
          { accountId: mine.revenueId, credit: "1" },
        ],
      },
    }),
  );

  expect(res.status).toBe(404);
  expect(await prisma.journalEntry.count()).toBe(0);
});

/** The BOOKKEEPER of a ledger-ready org, as a resolved scope. */
async function scopeFor(organizationId: string, slug: string, role = "BOOKKEEPER") {
  const membership = await prisma.membership.findFirstOrThrow({
    where: { organizationId, role: role as MembershipRole },
  });
  return resolveOrgScope(membership.userId, slug);
}

/** Post one balanced entry and return its id. */
async function postOne(env: {
  token: string;
  slug: string;
  periodId: string;
  cashId: string;
  revenueId: string;
}): Promise<string> {
  const res = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Sale",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "500" },
          { accountId: env.revenueId, credit: "500" },
        ],
      },
    }),
  );
  expect(res.status).toBe(201);
  return String(bodyOf(res)["entryId"]);
}

test("L20: reversing a posted entry creates a second, opposite entry", async () => {
  // A reversal does not undo anything. I2 makes posted rows read-only in the
  // database, so there is no edit path to write even if someone wanted one.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }),
  );

  expect(res.status).toBe(201);
  expect(await prisma.journalEntry.count()).toBe(2);

  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: entryId },
  });
  expect(original.reversedById).not.toBeNull();

  const reversal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: String(bodyOf(res)["entryId"]) },
  });
  expect(reversal.reversalOfId).toBe(entryId);
});

test("L21: the reversal inverts every line and the pair balances to zero", async () => {
  const env = await ledgerReady();
  const entryId = await postOne(env);

  await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }),
  );

  const entries = await guardedListEntries(
    await scopeFor(env.organizationId, env.slug),
  );
  expect(entries).toHaveLength(2);

  const shapes = entries.map((entry) =>
    entry.lines.map((line) => `${line.debit}/${line.credit}`).join(","),
  );
  expect(shapes[0]).not.toBe(shapes[1]);

  const lines = await prisma.journalLine.findMany({
    where: { organizationId: env.organizationId },
  });
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  expect(debit).toBe(credit);
});

test("L22: reversing twice is refused and the second attempt writes nothing", async () => {
  const env = await ledgerReady();
  const entryId = await postOne(env);
  const reverse = withOrgScope(env.slug, reverseEntryHandler(entryId));

  expect(
    (await reverse(req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }))).status,
  ).toBe(201);

  const second = await reverse(req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }));
  expect(second.status).toBe(422);
  expect(errorCode(second)).toBe("LEDGER_ALREADY_REVERSED");
  expect(await prisma.journalEntry.count()).toBe(2);
});

test("L23: a viewer cannot reverse", async () => {
  // Demoted inside the SAME organization, so what is refused is the permission
  // and not the tenancy.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  await prisma.membership.updateMany({
    where: { organizationId: env.organizationId, role: "BOOKKEEPER" },
    data: { role: "VIEWER" },
  });

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }),
  );

  expect(res.status).toBe(403);
  expect(await prisma.journalEntry.count()).toBe(1);
});

test("L24: another tenant cannot reverse your entry", async () => {
  const mine = await ledgerReady();
  const entryId = await postOne(mine);
  const theirs = await actor("OWNER");

  const res = await withOrgScope(mine.slug, reverseEntryHandler(entryId))(
    req("POST", { session: theirs.token, body: { reason: "mischief" } }),
  );

  expect(res.status).toBe(404);
  expect(await prisma.journalEntry.count()).toBe(1);
});

test("L25: an unknown entry id is 404, not 500", async () => {
  const env = await ledgerReady();

  const res = await withOrgScope(
    env.slug,
    reverseEntryHandler("00000000-0000-0000-0000-000000000000"),
  )(req("POST", { session: env.token, body: { reason: "correcting a misposted accrual" } }));

  expect(res.status).toBe(404);
});

test("L26: a malformed asOf is 400 and reverses nothing", async () => {
  const env = await ledgerReady();
  const entryId = await postOne(env);

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { asOf: "not a date", reason: "x" } }),
  );

  expect(res.status).toBe(400);
  expect(await prisma.journalEntry.count()).toBe(1);
});

test("L27: the journal lists posted entries, with amounts as strings", async () => {
  const env = await ledgerReady();
  await postOne(env);

  const entries = await guardedListEntries(
    await scopeFor(env.organizationId, env.slug),
  );

  expect(entries).toHaveLength(1);
  expect(entries[0]?.lines).toHaveLength(2);
  // A Prisma.Decimal reaching a React tree invites someone to add it up with
  // Number(), which is exactly what I8 forbids. A string cannot be totalled by
  // accident.
  expect(entries[0]?.lines[0]?.debit).toBe("500.0000");
  expect(typeof entries[0]?.lines[0]?.credit).toBe("string");
});

test("L28: the journal never shows another tenant entries", async () => {
  const mine = await ledgerReady();
  await postOne(mine);
  const theirs = await ledgerReady();

  const entries = await guardedListEntries(
    await scopeFor(theirs.organizationId, theirs.slug),
  );
  expect(entries).toHaveLength(0);
});

test("L29: reversing with no period for that date is 422, not 404", async () => {
  // The two facts were sharing one error class. "That entry does not exist"
  // must stay opaque because it may be an attempt to reach another tenant row;
  // "you have no period covering today" is a gap in the caller own books that
  // only they can fix, and telling them 404 sends them looking for a missing
  // entry instead of at their period list.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { asOf: "1990-06-01", reason: "wrong year" } }),
  );

  expect(res.status).toBe(422);
  expect(errorCode(res)).toBe("LEDGER_NO_PERIOD_FOR_DATE");
  expect(await prisma.journalEntry.count()).toBe(1);
});

test("L30: an explicit asOf posts the reversal into that period", async () => {
  // Reversing "as of" a date is the point of the parameter: the correction
  // lands in the period that covers it, which may not be the original period.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { asOf: "2024-06-15", reason: "restate into June" } }),
  );

  expect(res.status).toBe(201);
  const reversal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: String(bodyOf(res)["entryId"]) },
  });
  expect(reversal.periodId).toBe(env.periodId);
  expect(reversal.entryDate.toISOString().slice(0, 10)).toBe("2024-06-15");
});

test("L31: closing a period refuses further postings into it", async () => {
  const env = await ledgerReady("ACCOUNTANT");

  const closed = await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
    req("POST", {
      session: env.token,
      body: { action: "close", reason: "year end signed off" },
    }),
  );
  expect(closed.status).toBe(200);
  expect(bodyOf(closed)["status"]).toBe("CLOSED");

  const post = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Too late",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "1" },
          { accountId: env.revenueId, credit: "1" },
        ],
      },
    }),
  );

  expect(post.status).toBe(422);
  expect(errorCode(post)).toBe("LEDGER_PERIOD_NOT_OPEN");
  expect(await prisma.journalEntry.count()).toBe(0);
});

test("L32: a transition with no reason is refused", async () => {
  // I3 requires an unlock to be recorded in the audit trail, and the services
  // write that row. A row saying "unlocked by someone" answers nothing an
  // auditor asks -- the reason is what makes it worth having, so it is
  // mandatory rather than optional.
  const env = await ledgerReady("ACCOUNTANT");

  for (const body of [
    { action: "close" },
    { action: "close", reason: "   " },
    { action: "close", reason: "" },
  ]) {
    const res = await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
      req("POST", { session: env.token, body }),
    );
    expect(res.status).toBe(400);
  }

  const period = await prisma.period.findUniqueOrThrow({
    where: { id: env.periodId },
  });
  expect(period.status).toBe("OPEN");
});

test("L33: an unrecognised action is refused", async () => {
  const env = await ledgerReady("ACCOUNTANT");

  for (const action of ["delete", "CLOSE", "reopen", ""]) {
    const res = await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
      req("POST", { session: env.token, body: { action, reason: "because" } }),
    );
    expect(res.status).toBe(400);
  }
});

test("L34: a bookkeeper cannot close, an accountant cannot lock", async () => {
  // The permissions are not a gradient anybody should have to guess at:
  // close is ACCOUNTANT and above, lock and unlock are ADMIN and above.
  const bookkeeper = await ledgerReady("BOOKKEEPER");
  const refusedClose = await withOrgScope(
    bookkeeper.slug,
    transitionPeriodHandler(bookkeeper.periodId),
  )(req("POST", { session: bookkeeper.token, body: { action: "close", reason: "x" } }));
  expect(refusedClose.status).toBe(403);

  const accountant = await ledgerReady("ACCOUNTANT");
  const refusedLock = await withOrgScope(
    accountant.slug,
    transitionPeriodHandler(accountant.periodId),
  )(req("POST", { session: accountant.token, body: { action: "lock", reason: "x" } }));
  expect(refusedLock.status).toBe(403);
});

test("L35: an admin can lock, and a locked period refuses even an accountant", async () => {
  const env = await ledgerReady("ADMIN");

  const locked = await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
    req("POST", {
      session: env.token,
      body: { action: "lock", reason: "audit in progress" },
    }),
  );
  expect(locked.status).toBe(200);
  expect(bodyOf(locked)["status"]).toBe("LOCKED");

  const post = await withOrgScope(env.slug, postEntryHandler())(
    req("POST", {
      session: env.token,
      body: {
        periodId: env.periodId,
        entryDate: "2024-03-01",
        description: "Nope",
        currency: "USD",
        lines: [
          { accountId: env.cashId, debit: "1" },
          { accountId: env.revenueId, credit: "1" },
        ],
      },
    }),
  );
  expect(post.status).toBe(422);
  expect(await prisma.journalEntry.count()).toBe(0);
});

test("L36: the reason reaches the audit trail", async () => {
  // The whole justification for making it mandatory. If it were not stored,
  // requiring it would be ceremony.
  const env = await ledgerReady("ADMIN");
  const reason = "unlocked to correct the misposted March payroll accrual";

  await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
    req("POST", { session: env.token, body: { action: "lock", reason: "audit" } }),
  );
  await withOrgScope(env.slug, transitionPeriodHandler(env.periodId))(
    req("POST", { session: env.token, body: { action: "unlock", reason } }),
  );

  const rows = await prisma.auditLog.findMany({
    where: { organizationId: env.organizationId },
    orderBy: { createdAt: "asc" },
  });
  expect(JSON.stringify(rows)).toContain(reason);
});

test("L37: another tenant cannot transition your period", async () => {
  const mine = await ledgerReady("ADMIN");
  const theirs = await actor("OWNER");

  const res = await withOrgScope(mine.slug, transitionPeriodHandler(mine.periodId))(
    req("POST", {
      session: theirs.token,
      body: { action: "lock", reason: "mischief" },
    }),
  );

  expect(res.status).toBe(404);
  const period = await prisma.period.findUniqueOrThrow({
    where: { id: mine.periodId },
  });
  expect(period.status).toBe("OPEN");
});

test("L38: a reversal with no reason is refused and reverses nothing", async () => {
  // "Who" and "when" were already recorded. "Why" was not, and it is the one
  // that decides whether a reversal was a correction or a cover-up. The same
  // argument made the reason mandatory on a period transition; a reversal moves
  // money and deserves at least as much.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  for (const body of [{}, { reason: "   " }, { reason: "" }]) {
    const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
      req("POST", { session: env.token, body }),
    );
    expect(res.status).toBe(400);
  }

  expect(await prisma.journalEntry.count()).toBe(1);
});

test("L39: the reason reaches the audit trail and the reversal description", async () => {
  // Both, deliberately. The audit row is the record; the description is what
  // anyone reading the journal sees without having to open the audit page
  // beside it.
  const env = await ledgerReady();
  const entryId = await postOne(env);
  const reason = "customer disputed the March invoice";

  const res = await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { reason } }),
  );
  expect(res.status).toBe(201);

  const reversal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: String(bodyOf(res)["entryId"]) },
  });
  expect(reversal.description).toContain(reason);

  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: env.organizationId, action: "ledger.reverse" },
  });
  expect(JSON.stringify(audit.after)).toContain(reason);
});

test("L40: reversing writes an audit row naming the actor", async () => {
  // Asserted because I claimed in a PR body that it did NOT, having read my own
  // earlier note instead of the source. It always did. This pins it so the
  // claim cannot be made again without a failing test.
  const env = await ledgerReady();
  const entryId = await postOne(env);

  await withOrgScope(env.slug, reverseEntryHandler(entryId))(
    req("POST", { session: env.token, body: { reason: "duplicate posting" } }),
  );

  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: env.organizationId, action: "ledger.reverse" },
  });
  expect(audit.entityType).toBe("JournalEntry");
  expect(audit.entityId).toBe(entryId);
  expect(audit.actorId).not.toBe("");
  expect(audit.before).toEqual({ reversedById: null });
});

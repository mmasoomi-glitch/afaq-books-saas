import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { resetDb } from "../../setup";
import { prisma } from "../../../src/server/db/client";
import { registerUser, signIn } from "../../../src/server/auth/session";
import {
  createOrganization,
  grantMembership,
} from "../../../src/server/auth/membership";
import { resolveOrgScope } from "../../../src/server/auth/scope";
import {
  currentRequestId,
  newRequestId,
  runWithRequestId,
} from "../../../src/server/http/request-context";
import { CSRF_COOKIE, SESSION_COOKIE } from "../../../src/server/http/cookies";
import { CSRF_HEADER } from "../../../src/server/http/csrf";
import { toRouteHandler } from "../../../src/server/http/adapters/web";
import { withOrgScope } from "../../../src/server/http/handlers/scoped";
import { grantMemberHandler } from "../../../src/server/http/handlers/organizations";

/**
 * `request_id` on an audit row.
 *
 * I9 has required it since the table existed and it was null on every row. The
 * value is injected by a Prisma client extension rather than added at each of
 * the eleven places an audit row is written — so what these tests have to
 * establish is that the injection actually reaches all of them, including
 * inside a transaction.
 */

const PASSWORD = "correct horse battery staple";
const CSRF = "csrf-token-for-tests-0123456789";

beforeEach(async () => {
  await resetDb();
});

function newEmail(): string {
  return `${randomUUID()}@example.test`;
}

async function ownerScope() {
  const email = newEmail();
  const { userId } = await registerUser(email, PASSWORD);
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const { organizationId } = await createOrganization(userId, {
    slug,
    name: "Acme",
  });
  const { rawToken } = await signIn(email, PASSWORD);
  return {
    scope: await resolveOrgScope(userId, slug),
    organizationId,
    slug,
    token: rawToken,
  };
}

test("R1: outside a request there is no id, and that is recorded as null", async () => {
  // A service called by a test, or later by a scheduled job, was not caused by
  // a request. Inventing an id would make the trail claim a correlation that
  // does not exist.
  //
  // This test originally read the audit row written by `createOrganization`
  // and found none — because there was none. Creating an organization makes
  // the creator its OWNER, the most consequential role grant in the system,
  // and it was unaudited. Now it is `organization.create`.
  expect(currentRequestId()).toBeUndefined();

  const { scope } = await ownerScope();
  const row = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: scope.organizationId },
  });
  expect(row.requestId).toBeNull();
});

test("R2: inside runWithRequestId, the id reaches the audit row", async () => {
  const { scope } = await ownerScope();
  const id = newRequestId();
  const guest = newEmail();
  await registerUser(guest, PASSWORD);

  await runWithRequestId(id, async () => {
    await grantMembership(scope, guest, "VIEWER");
  });

  const row = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: scope.organizationId, action: "member.invite" },
  });
  expect(row.requestId).toBe(id);
});

test("R3: the context survives an await chain several layers deep", async () => {
  // The whole reason for AsyncLocalStorage over a parameter. `grantMembership`
  // awaits a user lookup, then opens a transaction, then writes inside it —
  // and none of those signatures mention a request id.
  const { scope } = await ownerScope();
  const id = newRequestId();

  await runWithRequestId(id, async () => {
    expect(currentRequestId()).toBe(id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(currentRequestId()).toBe(id);
    const guest = newEmail();
    await registerUser(guest, PASSWORD);
    await grantMembership(scope, guest, "BOOKKEEPER");
    expect(currentRequestId()).toBe(id);
  });

  expect(currentRequestId()).toBeUndefined();
});

test("R4: the extension applies INSIDE a Prisma transaction", async () => {
  // Asserted rather than assumed. A query extension that silently did not
  // apply to transaction clients would leave exactly the audit rows that
  // matter most — the ones written alongside a ledger write — without an id,
  // and every test that checked a non-transactional write would still pass.
  const { scope } = await ownerScope();
  const id = newRequestId();

  await runWithRequestId(id, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorId: scope.userId,
          action: "test.in.transaction",
          entityType: "Test",
          entityId: randomUUID(),
        },
      });
    });
  });

  const row = await prisma.auditLog.findFirstOrThrow({
    where: { action: "test.in.transaction" },
  });
  expect(row.requestId).toBe(id);
});

test("R5: an explicit requestId passed by a caller wins", async () => {
  // `??=` semantics. Nothing does this today; a replay or an import tool would
  // want to, and the injection must not overwrite a deliberate value.
  const { scope } = await ownerScope();
  const ambient = newRequestId();
  const explicit = newRequestId();

  await runWithRequestId(ambient, async () => {
    await prisma.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "test.explicit",
        entityType: "Test",
        entityId: randomUUID(),
        requestId: explicit,
      },
    });
  });

  const row = await prisma.auditLog.findFirstOrThrow({
    where: { action: "test.explicit" },
  });
  expect(row.requestId).toBe(explicit);
});

test("R6: a real request through the adapter stamps its own id", async () => {
  const owner = await ownerScope();
  const guest = newEmail();
  await registerUser(guest, PASSWORD);

  const route = toRouteHandler(
    withOrgScope(owner.slug, grantMemberHandler()),
  );

  const response = await route(
    new Request(`https://books.example.com/api/o/${owner.slug}/members`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${owner.token}; ${CSRF_COOKIE}=${CSRF}`,
        [CSRF_HEADER]: CSRF,
      },
      body: JSON.stringify({ email: guest, role: "VIEWER" }),
    }),
  );

  expect(response.status).toBe(201);

  // Echoed, so a caller reporting a problem can quote it without database
  // access.
  const echoed = response.headers.get("x-request-id");
  expect(echoed).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  const row = await prisma.auditLog.findFirstOrThrow({
    where: {
      organizationId: owner.organizationId,
      action: "member.invite",
    },
  });
  expect(row.requestId).toBe(echoed);
});

test("R7: two requests get different ids", async () => {
  const owner = await ownerScope();
  const route = toRouteHandler(withOrgScope(owner.slug, grantMemberHandler()));

  const ids: (string | null)[] = [];
  for (let i = 0; i < 2; i += 1) {
    const guest = newEmail();
    await registerUser(guest, PASSWORD);
    const response = await route(
      new Request(`https://books.example.com/api/o/${owner.slug}/members`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${owner.token}; ${CSRF_COOKIE}=${CSRF}`,
          [CSRF_HEADER]: CSRF,
        },
        body: JSON.stringify({ email: guest, role: "VIEWER" }),
      }),
    );
    expect(response.status).toBe(201);
    ids.push(response.headers.get("x-request-id"));
  }

  expect(ids[0]).not.toBe(ids[1]);
});

test("R8: an inbound x-request-id is ignored", async () => {
  // The header is client-controlled. An audit trail whose correlation id an
  // attacker chooses is one where they can make two unrelated actions look
  // like one request, or collide with somebody else's.
  const owner = await ownerScope();
  const guest = newEmail();
  await registerUser(guest, PASSWORD);
  const planted = "00000000-0000-0000-0000-00000000dead";

  const response = await toRouteHandler(
    withOrgScope(owner.slug, grantMemberHandler()),
  )(
    new Request(`https://books.example.com/api/o/${owner.slug}/members`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": planted,
        cookie: `${SESSION_COOKIE}=${owner.token}; ${CSRF_COOKIE}=${CSRF}`,
        [CSRF_HEADER]: CSRF,
      },
      body: JSON.stringify({ email: guest, role: "VIEWER" }),
    }),
  );

  expect(response.status).toBe(201);
  expect(response.headers.get("x-request-id")).not.toBe(planted);

  const row = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: owner.organizationId, action: "member.invite" },
  });
  expect(row.requestId).not.toBe(planted);
});

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
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  updateCustomerHandler,
  deactivateCustomerHandler,
  createInvoiceHandler,
  getInvoiceHandler,
  listInvoicesHandler,
  postInvoiceHandler,
  cancelInvoiceHandler,
  voidInvoiceHandler,
  createPaymentHandler,
  applyPaymentHandler,
  unapplyPaymentHandler,
  createCreditNoteHandler,
  issueCreditNoteHandler,
  applyCreditNoteHandler,
  expireCreditNoteHandler,
  arAgingHandler,
} from "../../../src/server/http/handlers/sales";

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

function ledgerFixture(
  scope: { organizationId: string },
): Promise<{ periodId: string; arAccountId: string; revenueAccountId: string }> {
  return Promise.all([
    prisma.period.create({
      data: {
        organizationId: scope.organizationId,
        name: "P1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
    }),
    prisma.account.create({
      data: {
        organizationId: scope.organizationId,
        code: "1300",
        name: "Accounts Receivable",
        type: "ASSET",
        currency: "USD",
      },
    }),
    prisma.account.create({
      data: {
        organizationId: scope.organizationId,
        code: "4000",
        name: "Revenue",
        type: "REVENUE",
        currency: "USD",
      },
    }),
  ]).then(([period, ar, revenue]) => ({
    periodId: period.id,
    arAccountId: ar.id,
    revenueAccountId: revenue.id,
  }));
}

async function bookkeeperScope(): Promise<{
  slug: string;
  organizationId: string;
  token: string;
}> {
  return actor("BOOKKEEPER");
}

// ── Customers ──────────────────────────────────────────────────────────

test("SC1: a bookkeeper can create a customer", async () => {
  const { token, slug, organizationId } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Acme Corp", currency: "USD" } }));

  expect(res.status).toBe(201);
  const body = bodyOf(res);
  expect(body["name"]).toBe("Acme Corp");
  expect(body["currency"]).toBe("USD");
  expect(await prisma.customer.count({ where: { organizationId } })).toBe(1);
});

test("SC2: a viewer cannot create a customer", async () => {
  const { token, slug, organizationId } = await actor("VIEWER");

  const res = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Acme Corp" } }));

  expect(res.status).toBe(403);
  expect(await prisma.customer.count({ where: { organizationId } })).toBe(0);
});

test("SC3: a customer name is required", async () => {
  const { token, slug } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { email: "a@b.test" } }));

  expect(res.status).toBe(400);
  expect(errorCode(res)).toBe("INVALID_BODY");
});

test("SC4: listing customers returns an empty array when none exist", async () => {
  const { token, slug } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    listCustomersHandler(),
  )(req("GET", { session: token }));

  expect(res.status).toBe(200);
  const body = bodyOf(res);
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBe(0);
});

test("SC5: getCustomer returns 404 for a non-existent customer", async () => {
  const { token, slug } = await bookkeeperScope();
  const fakeId = randomUUID();

  const res = await withOrgScope(
    slug,
    getCustomerHandler(fakeId),
  )(req("GET", { session: token }));

  expect(res.status).toBe(404);
});

// ── Invoices ───────────────────────────────────────────────────────────

test("SI1: create an invoice for an existing customer", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { arAccountId, revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test Customer" } }));
  expect(customerRes.status).toBe(201);
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  // Create draft invoice
  const createRes = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      currency: "USD",
      lines: [
        {
          accountId: revenueAccountId,
          description: "Consulting",
          quantity: 1,
          unitPrice: 100,
        },
      ],
    },
  }));
  expect(createRes.status).toBe(201);
  const body = bodyOf(createRes);
  expect(body["status"]).toBe("DRAFT");
  expect(body["totalAmount"]).toBe("100.00");

  // Verify invoice in DB
  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { organizationId },
  });
  expect(invoice.status).toBe("DRAFT");
});

test("SI2: post a draft invoice", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { arAccountId, revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer and invoice
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test Customer" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const createRes = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      currency: "USD",
      lines: [
        {
          accountId: revenueAccountId,
          description: "Consulting",
          quantity: 1,
          unitPrice: 100,
        },
      ],
    },
  }));
  const invoiceId = (bodyOf(createRes) as { id: string }).id;

  // Post the invoice
  const postRes = await withOrgScope(
    slug,
    postInvoiceHandler(invoiceId),
  )(req("POST", { session: token }));
  expect(postRes.status).toBe(201);

  // Verify invoice is posted
  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { organizationId },
  });
  expect(invoice.status).toBe("ISSUED");
});

test("SI3: required fields on invoice creation", async () => {
  const { slug, token } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", { session: token, body: {} }));

  expect(res.status).toBe(400);
  expect(errorCode(res)).toBe("INVALID_BODY");
});

test("SI4: invoice with invalid dates is 400", async () => {
  const { slug, token } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId: randomUUID(),
      issueDate: "not-a-date",
      dueDate: "not-a-date",
      lines: [],
    },
  }));

  expect(res.status).toBe(400);
});

test("SI5: void a draft invoice", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { revenueAccountId } = await ledgerFixture({ organizationId });

  // Create a draft invoice
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const createRes = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lines: [{ accountId: revenueAccountId, description: "Test", quantity: 1, unitPrice: 10 }],
    },
  }));
  const invoiceId = (bodyOf(createRes) as { id: string }).id;

  // Void it
  const voidRes = await withOrgScope(
    slug,
    voidInvoiceHandler(invoiceId),
  )(req("POST", { session: token }));
  expect(voidRes.status).toBe(200);

  // Verify it's void
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });
  expect(invoice?.status).toBe("VOID");
});

// ── Payments ───────────────────────────────────────────────────────────

test("SP1: create a payment", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();

  // Create customer
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test Customer" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  // Create payment
  const res = await withOrgScope(
    slug,
    createPaymentHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      paymentDate: "2026-01-15",
      amount: 500,
      method: "WIRE",
    },
  }));
  expect(res.status).toBe(201);
  const body = bodyOf(res);
  expect(body["customerId"]).toBe(customerId);

  // Verify in DB
  const payment = await prisma.customerPayment.findFirstOrThrow({
    where: { organizationId },
  });
  expect(Number(payment.amount)).toBe(500);
});

test("SP2: payment requires required fields", async () => {
  const { slug, token } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    createPaymentHandler(),
  )(req("POST", { session: token, body: { customerId: randomUUID() } }));

  expect(res.status).toBe(400);
});

test("SP3: apply a payment to an invoice", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { arAccountId, revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer, invoice, post invoice
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const invoiceRes = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lines: [{ accountId: revenueAccountId, description: "Test", quantity: 1, unitPrice: 500 }],
    },
  }));
  const invoiceId = (bodyOf(invoiceRes) as { id: string }).id;

  await withOrgScope(slug, postInvoiceHandler(invoiceId))(req("POST", { session: token }));

  // Create payment
  const paymentRes = await withOrgScope(
    slug,
    createPaymentHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      paymentDate: "2026-01-15",
      amount: 500,
      method: "WIRE",
    },
  }));
  const paymentId = (bodyOf(paymentRes) as { id: string }).id;

  // Apply payment
  const applyRes = await withOrgScope(
    slug,
    applyPaymentHandler(paymentId),
  )(req("POST", {
    session: token,
    body: {
      allocations: [{ invoiceId, amount: "500" }],
    },
  }));
  expect(applyRes.status).toBe(201);

  // Verify payment allocation exists
  const alloc = await prisma.paymentAllocation.findFirstOrThrow({
    where: { organizationId },
  });
  expect(alloc.invoiceId).toBe(invoiceId);
});

// ── Credit Notes ──────────────────────────────────────────────────────

test("SCN1: create a credit note", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  // Create credit note
  const res = await withOrgScope(
    slug,
    createCreditNoteHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-15",
      currency: "USD",
      reason: "Defective goods",
      lines: [{ accountId: revenueAccountId, description: "Refund", quantity: 1, unitPrice: 100 }],
    },
  }));
  expect(res.status).toBe(201);
  const body = bodyOf(res);
  expect(body["status"]).toBe("DRAFT");
});

test("SCN2: issue a credit note", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer and draft credit note
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const cnRes = await withOrgScope(
    slug,
    createCreditNoteHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-15",
      lines: [{ accountId: revenueAccountId, description: "Refund", quantity: 1, unitPrice: 100 }],
    },
  }));
  const creditNoteId = (bodyOf(cnRes) as { id: string }).id;

  // Issue it
  const issueRes = await withOrgScope(
    slug,
    issueCreditNoteHandler(creditNoteId),
  )(req("POST", { session: token }));
  expect(issueRes.status).toBe(201);

  // Verify status
  const cn = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  expect(cn?.status).toBe("ISSUED");
});

test("SCN3: expire a credit note", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer and draft credit note
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const cnRes = await withOrgScope(
    slug,
    createCreditNoteHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-15",
      lines: [{ accountId: revenueAccountId, description: "Refund", quantity: 1, unitPrice: 100 }],
    },
  }));
  const creditNoteId = (bodyOf(cnRes) as { id: string }).id;

  // Issue then expire
  await withOrgScope(slug, issueCreditNoteHandler(creditNoteId))(req("POST", { session: token }));

  const expireRes = await withOrgScope(
    slug,
    expireCreditNoteHandler(creditNoteId),
  )(req("POST", { session: token }));
  expect(expireRes.status).toBe(200);

  const cn = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
  });
  expect(cn?.status).toBe("EXPIRED");
});

// ── AR Aging ───────────────────────────────────────────────────────────

test("SA1: ar-aging returns empty when no receivables", async () => {
  const { slug, token } = await bookkeeperScope();

  const res = await withOrgScope(
    slug,
    arAgingHandler(),
  )(req("GET", { session: token }));

  expect(res.status).toBe(200);
  const body = bodyOf(res);
  expect(body["totals"]).toBeDefined();
  expect(Array.isArray(body["totals"])).toBe(true);
});

test("SA2: ar-aging returns data after posting invoice", async () => {
  const { slug, organizationId, token } = await bookkeeperScope();
  const { arAccountId, revenueAccountId } = await ledgerFixture({ organizationId });

  // Create customer and posted invoice
  const customerRes = await withOrgScope(
    slug,
    createCustomerHandler(),
  )(req("POST", { session: token, body: { name: "Test" } }));
  const customerId = (bodyOf(customerRes) as { id: string }).id;

  const invoiceRes = await withOrgScope(
    slug,
    createInvoiceHandler(),
  )(req("POST", {
    session: token,
    body: {
      customerId,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      lines: [{ accountId: revenueAccountId, description: "Test", quantity: 1, unitPrice: 1000 }],
    },
  }));
  const invoiceId = (bodyOf(invoiceRes) as { id: string }).id;

  await withOrgScope(slug, postInvoiceHandler(invoiceId))(req("POST", { session: token }));

  // AR aging should have data
  const res = await withOrgScope(
    slug,
    arAgingHandler(),
  )(req("GET", { session: token }));
  expect(res.status).toBe(200);
  const body = bodyOf(res);
  expect(Array.isArray(body["totals"])).toBe(true);
  expect(Array.isArray(body["customers"])).toBe(true);
});

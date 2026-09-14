import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

export type CustomerPaymentMethod =
  "WIRE" | "CHECK" | "CREDIT_CARD" | "CASH" | "ONLINE" | "CONNECTOR";
export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";
export type CreditNoteStatus = "DRAFT" | "ISSUED" | "APPLIED" | "EXPIRED";

export interface CustomerAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  billingAddress?: CustomerAddress;
  taxId?: string;
  currency?: string;
  accountNumber?: string;
  paymentTerms?: number;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  billingAddress?: CustomerAddress;
  taxId?: string;
  currency?: string;
  accountNumber?: string;
  paymentTerms?: number;
}

export interface CustomerFilters {
  name?: string;
  email?: string;
  isActive?: boolean;
}

export interface CustomerSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly currency: string;
  readonly accountNumber: string | null;
  readonly paymentTerms: number | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export async function createCustomer(
  scope: LedgerScope,
  input: CreateCustomerInput,
): Promise<CustomerSummary> {
  return withTx(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        organizationId: scope.organizationId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        ...(input.billingAddress !== undefined ? { billingAddress: input.billingAddress } : {}),
        taxId: input.taxId ?? null,
        currency: input.currency ?? "USD",
        accountNumber: input.accountNumber ?? null,
        paymentTerms: input.paymentTerms ?? 30,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.customer.create",
        entityType: "Customer",
        entityId: customer.id,
        after: { name: customer.name, email: customer.email },
      },
    });

    return toSummary(customer);
  });
}

export async function getCustomer(
  scope: LedgerScope,
  customerId: string,
): Promise<CustomerSummary | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId: scope.organizationId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
      phone: true,
      currency: true,
      accountNumber: true,
      paymentTerms: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return customer ? toSummary(customer) : null;
}

export async function listCustomers(
  scope: LedgerScope,
  filters?: CustomerFilters,
): Promise<CustomerSummary[]> {
  const where: Prisma.CustomerWhereInput = {
    organizationId: scope.organizationId,
    ...(filters?.name !== undefined
      ? { name: { contains: filters.name, mode: "insensitive" } }
      : {}),
    ...(filters?.email !== undefined
      ? { email: { contains: filters.email, mode: "insensitive" } }
      : {}),
    ...(filters?.isActive !== undefined
      ? { isActive: filters.isActive }
      : {}),
  };

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      email: true,
      phone: true,
      currency: true,
      accountNumber: true,
      paymentTerms: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return customers.map(toSummary);
}

export async function updateCustomer(
  scope: LedgerScope,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerSummary> {
  return withTx(async (tx) => {
    const before = await tx.customer.findFirst({
      where: { id: customerId, organizationId: scope.organizationId },
    });
    if (before === null) {
      throw new NotFoundError(`customer ${customerId} not found`);
    }

    const customer = await tx.customer.update({
      where: { id: customerId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.billingAddress !== undefined
          ? { billingAddress: input.billingAddress }
          : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.accountNumber !== undefined
          ? { accountNumber: input.accountNumber }
          : {}),
        ...(input.paymentTerms !== undefined
          ? { paymentTerms: input.paymentTerms }
          : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.customer.update",
        entityType: "Customer",
        entityId: customerId,
        before: { name: before.name, email: before.email },
        after: { name: customer.name, email: customer.email },
      },
    });

    return toSummary(customer);
  });
}

export async function deactivateCustomer(
  scope: LedgerScope,
  customerId: string,
): Promise<CustomerSummary> {
  return withTx(async (tx) => {
    const before = await tx.customer.findFirst({
      where: { id: customerId, organizationId: scope.organizationId },
    });
    if (before === null) {
      throw new NotFoundError(`customer ${customerId} not found`);
    }

    const customer = await tx.customer.update({
      where: { id: customerId },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "sales.customer.deactivate",
        entityType: "Customer",
        entityId: customerId,
        before: { isActive: true },
        after: { isActive: false },
      },
    });

    return toSummary(customer);
  });
}

function toSummary(c: {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency: string;
  accountNumber: string | null;
  paymentTerms: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CustomerSummary {
  return {
    id: c.id,
    organizationId: c.organizationId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    currency: c.currency,
    accountNumber: c.accountNumber,
    paymentTerms: c.paymentTerms,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

import { Prisma } from "@prisma/client";
import type { Supplier } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { TxClient } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

export interface CreateSupplierInput {
  name: string;
  email?: string;
  phone?: string;
  billingAddress?: unknown;
  taxId?: string;
  currency?: string;
  accountNumber?: string;
  paymentTerms?: number;
}

export interface UpdateSupplierInput {
  name?: string;
  email?: string;
  phone?: string;
  billingAddress?: unknown;
  taxId?: string;
  currency?: string;
  accountNumber?: string;
  paymentTerms?: number;
  isActive?: boolean;
}

export interface SupplierFilter {
  isActive?: boolean;
  currency?: string;
  search?: string;
}

const ZERO = new Prisma.Decimal(0);

function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

export async function createSupplier(
  scope: LedgerScope,
  input: CreateSupplierInput,
): Promise<Supplier> {
  return withTx(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        organizationId: scope.organizationId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        billingAddress: input.billingAddress ?? null,
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
        action: "procurement.supplier.create",
        entityType: "Supplier",
        entityId: supplier.id,
        after: { name: supplier.name, email: supplier.email },
      },
    });

    return supplier;
  });
}

export async function getSupplier(
  scope: LedgerScope,
  supplierId: string,
): Promise<Supplier | null> {
  return prisma.supplier.findFirst({
    where: { id: supplierId, organizationId: scope.organizationId },
  });
}

export async function listSuppliers(
  scope: LedgerScope,
  filters: SupplierFilter = {},
): Promise<Supplier[]> {
  const where: Prisma.SupplierWhereInput = {
    organizationId: scope.organizationId,
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.currency !== undefined ? { currency: filters.currency } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
            { accountNumber: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  return prisma.supplier.findMany({
    where,
    orderBy: { name: "asc" },
  });
}

export async function updateSupplier(
  scope: LedgerScope,
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<Supplier> {
  return withTx(async (tx) => {
    const existing = await tx.supplier.findFirst({
      where: { id: supplierId, organizationId: scope.organizationId },
    });
    if (existing === null) {
      throw new NotFoundError(`supplier ${supplierId} not found`);
    }

    const supplier = await tx.supplier.update({
      where: { id: supplierId },
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
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.supplier.update",
        entityType: "Supplier",
        entityId: supplier.id,
        before: {
          name: existing.name,
          email: existing.email,
          isActive: existing.isActive,
        },
        after: { name: supplier.name, email: supplier.email, isActive: supplier.isActive },
      },
    });

    return supplier;
  });
}

export async function deactivateSupplier(
  scope: LedgerScope,
  supplierId: string,
): Promise<Supplier> {
  return updateSupplier(scope, supplierId, { isActive: false });
}

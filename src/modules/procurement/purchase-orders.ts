import { Prisma } from "@prisma/client";
import type { PurchaseOrder } from "@prisma/client";
import { prisma } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

const ZERO = new Prisma.Decimal(0);

function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

export interface POLineInput {
  lineNumber: number;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
}

export interface CreatePOInput {
  supplierId: string;
  poNumber?: number;
  orderDate: Date;
  expectedDelivery?: Date;
  currency?: string;
  memo?: string;
  notes?: string;
  lines: POLineInput[];
}

export interface PurchaseOrderFilter {
  status?: string;
  supplierId?: string;
}

function computePototals(lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[]) {
  const subtotal = lines.reduce((sum, l) => sum.add(l.lineTotal), ZERO);
  const taxAmount = new Prisma.Decimal(0);
  const totalAmount = subtotal;
  return { subtotal, taxAmount, totalAmount };
}

export async function createPurchaseOrder(
  scope: LedgerScope,
  input: CreatePOInput,
): Promise<PurchaseOrder> {
  return withTx(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (supplier === null) {
      throw new NotFoundError(`supplier ${input.supplierId} not found`);
    }

    const lineData: Array<{
      lineNumber: number;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }> = [];

    for (const lineInput of input.lines) {
      const quantity = dec(lineInput.quantity);
      const unitPrice = dec(lineInput.unitPrice);
      const lineTotal = quantity.mul(unitPrice);

      lineData.push({
        lineNumber: lineInput.lineNumber,
        description: lineInput.description,
        quantity,
        unitPrice,
        lineTotal,
      });
    }

    const totals = computePototals(lineData);
    const currency = input.currency ?? "USD";

    const po = await tx.purchaseOrder.create({
      data: {
        organizationId: scope.organizationId,
        supplierId: input.supplierId,
        poNumber: input.poNumber ?? null,
        orderDate: input.orderDate,
        expectedDelivery: input.expectedDelivery ?? null,
        currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
        status: "DRAFT",
        poLines: {
          create: lineData.map((l) => ({
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.po.create",
        entityType: "PurchaseOrder",
        entityId: po.id,
        after: {
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          totalAmount: po.totalAmount.toString(),
        },
      },
    });

    return po;
  });
}

export async function getPurchaseOrder(
  scope: LedgerScope,
  poId: string,
): Promise<PurchaseOrder & { poLines: unknown[] } | null> {
  return prisma.purchaseOrder.findFirst({
    where: { id: poId, organizationId: scope.organizationId },
    include: { poLines: { orderBy: { lineNumber: "asc" } } },
  });
}

export async function listPurchaseOrders(
  scope: LedgerScope,
  filters: PurchaseOrderFilter = {},
): Promise<PurchaseOrder[]> {
  const where: Prisma.PurchaseOrderWhereInput = {
    organizationId: scope.organizationId,
    ...(filters.status !== undefined ? { status: filters.status as Prisma.EnumPurchaseOrderStatus | Prisma.EnumPurchaseOrderStatus[] } : {}),
    ...(filters.supplierId !== undefined ? { supplierId: filters.supplierId } : {}),
  };

  return prisma.purchaseOrder.findMany({
    where,
    orderBy: { orderDate: "desc" },
  });
}

export async function sendPurchaseOrder(
  scope: LedgerScope,
  poId: string,
): Promise<PurchaseOrder> {
  return withTx(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: poId, organizationId: scope.organizationId },
    });
    if (po === null) {
      throw new NotFoundError(`PO ${poId} not found`);
    }
    if (po.status !== "DRAFT") {
      throw new Error(`cannot send PO in ${po.status} status`);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: "SENT" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.po.send",
        entityType: "PurchaseOrder",
        entityId: poId,
        before: { status: "DRAFT" },
        after: { status: "SENT" },
      },
    });

    return updated;
  });
}

export async function confirmPurchaseOrder(
  scope: LedgerScope,
  poId: string,
): Promise<PurchaseOrder> {
  return withTx(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: poId, organizationId: scope.organizationId },
    });
    if (po === null) {
      throw new NotFoundError(`PO ${poId} not found`);
    }
    if (po.status !== "SENT") {
      throw new Error(`cannot confirm PO in ${po.status} status`);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: "CONFIRMED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.po.confirm",
        entityType: "PurchaseOrder",
        entityId: poId,
        before: { status: "SENT" },
        after: { status: "CONFIRMED" },
      },
    });

    return updated;
  });
}

export async function receivePurchaseOrder(
  scope: LedgerScope,
  poId: string,
  convertToBill: boolean = false,
): Promise<PurchaseOrder> {
  return withTx(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: poId, organizationId: scope.organizationId },
      include: { poLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (po === null) {
      throw new NotFoundError(`PO ${poId} not found`);
    }
    if (po.status !== "CONFIRMED") {
      throw new Error(`cannot receive PO in ${po.status} status`);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: "RECEIVED" },
    });

    if (convertToBill && po.poLines.length > 0) {
      // Convert PO lines to a draft bill
      const currency = po.currency;

      // Build bill lines from PO lines
      const billLines = po.poLines.map((poLine) => ({
        lineNumber: poLine.lineNumber,
        description: poLine.description,
        accountId: "", // Would need GL account mapping — default to empty
        quantity: poLine.quantity,
        unitPrice: poLine.unitPrice,
        taxRate: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal(0),
        lineTotal: poLine.lineTotal,
      }));

      const subtotal = billLines.reduce(
        (sum, l) => sum.add(l.lineTotal),
        ZERO,
      );
      const taxAmount = billLines.reduce(
        (sum, l) => sum.add(l.taxAmount),
        ZERO,
      );
      const totalAmount = subtotal.add(taxAmount);

      await tx.bill.create({
        data: {
          organizationId: scope.organizationId,
          supplierId: po.supplierId,
          billDate: new Date(),
          dueDate: new Date(),
          currency,
          subtotal,
          taxAmount,
          totalAmount,
          amountPaid: new Prisma.Decimal(0),
          amountDue: totalAmount,
          status: "DRAFT",
          memo: `Auto-generated from PO ${po.poNumber ?? po.id}`,
          billLines: {
            create: billLines.map((l) => ({
              lineNumber: l.lineNumber,
              description: l.description,
              accountId: l.accountId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRate: l.taxRate,
              taxAmount: l.taxAmount,
              lineTotal: l.lineTotal,
            })),
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.po.receive",
        entityType: "PurchaseOrder",
        entityId: poId,
        before: { status: "CONFIRMED" },
        after: { status: "RECEIVED" },
      },
    });

    return updated;
  });
}

export async function cancelPurchaseOrder(
  scope: LedgerScope,
  poId: string,
  reason: string,
): Promise<PurchaseOrder> {
  return withTx(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: poId, organizationId: scope.organizationId },
    });
    if (po === null) {
      throw new NotFoundError(`PO ${poId} not found`);
    }
    if (po.status === "CANCELLED") {
      throw new Error("PO is already cancelled");
    }

    const updated = await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: "CANCELLED" },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "procurement.po.cancel",
        entityType: "PurchaseOrder",
        entityId: poId,
        before: { status: po.status },
        after: { status: "CANCELLED", reason },
      },
    });

    return updated;
  });
}

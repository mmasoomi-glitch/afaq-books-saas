import type { Supplier, Bill, SupplierPayment, BillPaymentAllocation, PurchaseOrder } from "@prisma/client";
import type { OrgScope } from "../../server/auth/scope";
import { assertCanDo, toLedgerScope } from "../../server/auth/scope";
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  SupplierFilter,
} from "./suppliers";
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
  deactivateSupplier,
} from "./suppliers";
import type { CreateBillInput, BillFilter } from "./bills";
import { createBill, getBill, listBills, approveBill, cancelBill, voidBill } from "./bills";
import type { CreatePaymentInput, PaymentAllocationInput } from "./supplier-payments";
import { createSupplierPayment, applyPayment, unapplyPayment } from "./supplier-payments";
import type { CreatePOInput, PurchaseOrderFilter } from "./purchase-orders";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  sendPurchaseOrder,
  confirmPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
} from "./purchase-orders";
import type { APagingResult } from "./ap-aging";
import { apAging } from "./ap-aging";

// ── Suppliers ───────────────────────────────────────────────────────

export async function guardedCreateSupplier(
  scope: OrgScope,
  input: CreateSupplierInput,
): Promise<Supplier> {
  assertCanDo(scope, "procurement.supplier.create");
  return createSupplier(toLedgerScope(scope), input);
}

export async function guardedGetSupplier(
  scope: OrgScope,
  supplierId: string,
): Promise<Supplier | null> {
  assertCanDo(scope, "procurement.supplier.read");
  return getSupplier(toLedgerScope(scope), supplierId);
}

export async function guardedListSuppliers(
  scope: OrgScope,
  filters?: SupplierFilter,
): Promise<Supplier[]> {
  assertCanDo(scope, "procurement.supplier.read");
  return listSuppliers(toLedgerScope(scope), filters);
}

export async function guardedUpdateSupplier(
  scope: OrgScope,
  supplierId: string,
  input: UpdateSupplierInput,
): Promise<Supplier> {
  assertCanDo(scope, "procurement.supplier.create");
  return updateSupplier(toLedgerScope(scope), supplierId, input);
}

export async function guardedDeactivateSupplier(
  scope: OrgScope,
  supplierId: string,
): Promise<Supplier> {
  assertCanDo(scope, "procurement.supplier.create");
  return deactivateSupplier(toLedgerScope(scope), supplierId);
}

// ── Bills ───────────────────────────────────────────────────────────

export async function guardedCreateBill(
  scope: OrgScope,
  input: CreateBillInput,
): Promise<Bill> {
  assertCanDo(scope, "procurement.bill.create");
  return createBill(toLedgerScope(scope), input);
}

export async function guardedGetBill(
  scope: OrgScope,
  billId: string,
): Promise<Bill | null> {
  assertCanDo(scope, "procurement.supplier.read");
  return getBill(toLedgerScope(scope), billId);
}

export async function guardedListBills(
  scope: OrgScope,
  filters?: BillFilter,
): Promise<Bill[]> {
  assertCanDo(scope, "procurement.supplier.read");
  return listBills(toLedgerScope(scope), filters);
}

export async function guardedApproveBill(
  scope: OrgScope,
  billId: string,
  approverId: string,
): Promise<Bill> {
  assertCanDo(scope, "procurement.bill.approve");
  return approveBill(toLedgerScope(scope), billId, approverId);
}

export async function guardedCancelBill(
  scope: OrgScope,
  billId: string,
  reason: string,
): Promise<Bill> {
  assertCanDo(scope, "procurement.bill.cancel");
  return cancelBill(toLedgerScope(scope), billId, reason);
}

export async function guardedVoidBill(
  scope: OrgScope,
  billId: string,
): Promise<Bill> {
  assertCanDo(scope, "procurement.bill.cancel");
  return voidBill(toLedgerScope(scope), billId);
}

// ── Supplier Payments ──────────────────────────────────────────────

export async function guardedCreateSupplierPayment(
  scope: OrgScope,
  input: CreatePaymentInput,
): Promise<SupplierPayment> {
  assertCanDo(scope, "procurement.payment.create");
  return createSupplierPayment(toLedgerScope(scope), input);
}

export async function guardedApplySupplierPayment(
  scope: OrgScope,
  paymentId: string,
  allocations: PaymentAllocationInput[],
): Promise<{ payment: SupplierPayment; allocations: BillPaymentAllocation[] }> {
  assertCanDo(scope, "procurement.payment.apply");
  return applyPayment(toLedgerScope(scope), paymentId, allocations);
}

export async function guardedUnapplyPayment(
  scope: OrgScope,
  allocationId: string,
): Promise<BillPaymentAllocation> {
  assertCanDo(scope, "procurement.payment.apply");
  return unapplyPayment(toLedgerScope(scope), allocationId);
}

// ── Purchase Orders ────────────────────────────────────────────────

export async function guardedCreatePurchaseOrder(
  scope: OrgScope,
  input: CreatePOInput,
): Promise<PurchaseOrder> {
  assertCanDo(scope, "procurement.po.create");
  return createPurchaseOrder(toLedgerScope(scope), input);
}

export async function guardedGetPurchaseOrder(
  scope: OrgScope,
  poId: string,
): Promise<PurchaseOrder | null> {
  assertCanDo(scope, "procurement.supplier.read");
  return getPurchaseOrder(toLedgerScope(scope), poId);
}

export async function guardedListPurchaseOrders(
  scope: OrgScope,
  filters?: PurchaseOrderFilter,
): Promise<PurchaseOrder[]> {
  assertCanDo(scope, "procurement.supplier.read");
  return listPurchaseOrders(toLedgerScope(scope), filters);
}

export async function guardedSendPurchaseOrder(
  scope: OrgScope,
  poId: string,
): Promise<PurchaseOrder> {
  assertCanDo(scope, "procurement.po.create");
  return sendPurchaseOrder(toLedgerScope(scope), poId);
}

export async function guardedConfirmPurchaseOrder(
  scope: OrgScope,
  poId: string,
): Promise<PurchaseOrder> {
  assertCanDo(scope, "procurement.po.create");
  return confirmPurchaseOrder(toLedgerScope(scope), poId);
}

export async function guardedReceivePurchaseOrder(
  scope: OrgScope,
  poId: string,
  convertToBill: boolean = false,
): Promise<PurchaseOrder> {
  assertCanDo(scope, "procurement.po.create");
  return receivePurchaseOrder(toLedgerScope(scope), poId, convertToBill);
}

export async function guardedCancelPurchaseOrder(
  scope: OrgScope,
  poId: string,
  reason: string,
): Promise<PurchaseOrder> {
  assertCanDo(scope, "procurement.po.create");
  return cancelPurchaseOrder(toLedgerScope(scope), poId, reason);
}

// ── A/P Aging ──────────────────────────────────────────────────────

export async function guardedApAging(
  scope: OrgScope,
  asOf?: Date,
): Promise<APagingResult> {
  assertCanDo(scope, "procurement.report.read");
  return apAging(toLedgerScope(scope), asOf);
}

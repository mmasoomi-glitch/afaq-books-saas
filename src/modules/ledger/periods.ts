import type { Period, Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client.js";
import { withTx } from "../../server/tx/with-tx.js";
import type { CreatePeriodInput, LedgerScope } from "./scope.js";
import { NotFoundError, PeriodNotOpenError } from "./errors.js";

async function requirePeriod(
  tx: Prisma.TransactionClient,
  scope: LedgerScope,
  periodId: string,
): Promise<Period> {
  const period = await tx.period.findFirst({
    where: { id: periodId, organizationId: scope.organizationId },
  });
  if (period === null) {
    throw new NotFoundError(`period ${periodId} not found`);
  }
  return period;
}

export async function createPeriod(
  scope: LedgerScope,
  input: CreatePeriodInput,
): Promise<Period> {
  return withTx(async (tx) => {
    const period = await tx.period.create({
      data: {
        organizationId: scope.organizationId,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.period.create",
        entityType: "Period",
        entityId: period.id,
        after: { name: period.name, status: period.status },
      },
    });
    return period;
  });
}

/**
 * Throws unless the period exists, belongs to this organization and is OPEN.
 * The database enforces this too (je_period_open); this exists so callers get
 * a named error instead of a raw constraint violation.
 */
export async function assertPeriodOpen(
  scope: LedgerScope,
  periodId: string,
): Promise<void> {
  const period = await prisma.period.findFirst({
    where: { id: periodId, organizationId: scope.organizationId },
    select: { status: true },
  });
  if (period === null) {
    throw new NotFoundError(`period ${periodId} not found`);
  }
  if (period.status !== "OPEN") {
    throw new PeriodNotOpenError(
      `period ${periodId} is ${period.status}, not OPEN`,
    );
  }
}

export async function closePeriod(
  scope: LedgerScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  return withTx(async (tx) => {
    const before = await requirePeriod(tx, scope, periodId);
    const period = await tx.period.update({
      where: { id: periodId },
      data: { status: "CLOSED" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.period.close",
        entityType: "Period",
        entityId: periodId,
        before: { status: before.status },
        after: { status: period.status, reason },
      },
    });
    return period;
  });
}

export async function lockPeriod(
  scope: LedgerScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  return withTx(async (tx) => {
    const before = await requirePeriod(tx, scope, periodId);
    const period = await tx.period.update({
      where: { id: periodId },
      data: { status: "LOCKED", lockedAt: new Date(), lockedBy: scope.userId },
    });
    // period_locks is the append-only history of lock/unlock actions. A status
    // column alone cannot answer "who locked this, when, and why".
    await tx.periodLock.create({
      data: {
        organizationId: scope.organizationId,
        periodId,
        action: "LOCK",
        reason,
        actorId: scope.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.period.lock",
        entityType: "Period",
        entityId: periodId,
        before: { status: before.status },
        after: { status: period.status, reason },
      },
    });
    return period;
  });
}

export async function unlockPeriod(
  scope: LedgerScope,
  periodId: string,
  reason: string,
): Promise<Period> {
  return withTx(async (tx) => {
    const before = await requirePeriod(tx, scope, periodId);
    const period = await tx.period.update({
      where: { id: periodId },
      data: { status: "OPEN", lockedAt: null, lockedBy: null },
    });
    await tx.periodLock.create({
      data: {
        organizationId: scope.organizationId,
        periodId,
        action: "UNLOCK",
        reason,
        actorId: scope.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.period.unlock",
        entityType: "Period",
        entityId: periodId,
        before: { status: before.status },
        after: { status: period.status, reason },
      },
    });
    return period;
  });
}

import { Prisma } from "@prisma/client";
import { withTx } from "../../server/tx/with-tx";
import type { LedgerScope } from "./scope";
import {
  AlreadyReversedError,
  InvalidLineError,
  NotFoundError,
  NotPostedError,
  PeriodNotOpenError,
  UnbalancedEntryError,
} from "./errors";

const ZERO = new Prisma.Decimal(0);

export interface PostLineInput {
  accountId: string;
  debit?: Prisma.Decimal | string;
  credit?: Prisma.Decimal | string;
  fxRate?: Prisma.Decimal | string;
  memo?: string;
}

export interface PostJournalInput {
  periodId: string;
  entryDate: Date;
  description: string;
  currency: string;
  sourceModule?: string;
  sourceId?: string;
  lines: PostLineInput[];
}

export interface PostedEntry {
  entryId: string;
  journalNumber: number;
}

/** Money is Decimal end to end. A JavaScript float anywhere near an amount is
 *  a defect — see accounting-integrity I8. */
function dec(value: Prisma.Decimal | string | undefined): Prisma.Decimal {
  return value === undefined ? ZERO : new Prisma.Decimal(value);
}

/**
 * Must match the database CHECK jl_reporting_amount_consistent exactly:
 *   reporting_amount = round((debit + credit) * fx_rate, 4)
 * Postgres round() on numeric rounds half away from zero, which is
 * decimal.js ROUND_HALF_UP. Getting this wrong means every insert is
 * rejected by the constraint.
 */
function reportingAmount(
  debit: Prisma.Decimal,
  credit: Prisma.Decimal,
  fxRate: Prisma.Decimal,
): Prisma.Decimal {
  return debit
    .add(credit)
    .mul(fxRate)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

interface NormalisedLine {
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  fxRate: Prisma.Decimal;
  reportingAmount: Prisma.Decimal;
  memo: string | null;
}

/**
 * Service-level validation, run before anything touches the database. The
 * database enforces all of this too; doing it here means a caller gets a named
 * error describing what is wrong instead of a raw constraint violation.
 */
function normaliseLines(lines: PostLineInput[]): NormalisedLine[] {
  if (lines.length < 2) {
    throw new InvalidLineError(
      `a journal entry needs at least 2 lines, got ${lines.length}`,
    );
  }

  return lines.map((line, index) => {
    const debit = dec(line.debit);
    const credit = dec(line.credit);
    const fxRate =
      line.fxRate === undefined
        ? new Prisma.Decimal(1)
        : new Prisma.Decimal(line.fxRate);

    if (debit.isNegative() || credit.isNegative()) {
      throw new InvalidLineError(
        `line ${index + 1}: amounts cannot be negative (debit=${debit.toString()}, credit=${credit.toString()})`,
      );
    }
    if (debit.greaterThan(ZERO) && credit.greaterThan(ZERO)) {
      throw new InvalidLineError(
        `line ${index + 1}: a line is a debit or a credit, never both`,
      );
    }
    if (debit.isZero() && credit.isZero()) {
      throw new InvalidLineError(`line ${index + 1}: amount is zero`);
    }
    if (!fxRate.greaterThan(ZERO)) {
      throw new InvalidLineError(`line ${index + 1}: fxRate must be positive`);
    }

    return {
      accountId: line.accountId,
      debit,
      credit,
      fxRate,
      reportingAmount: reportingAmount(debit, credit, fxRate),
      memo: line.memo ?? null,
    };
  });
}

function assertBalanced(lines: NormalisedLine[]): void {
  const debits = lines.reduce((sum, l) => sum.add(l.debit), ZERO);
  const credits = lines.reduce((sum, l) => sum.add(l.credit), ZERO);
  if (!debits.equals(credits)) {
    throw new UnbalancedEntryError(
      `debits ${debits.toString()} do not equal credits ${credits.toString()}`,
    );
  }
}

/**
 * Allocate the next journal number for (organization, period) using
 * SELECT ... FOR UPDATE on a dedicated counter row.
 *
 * NOT MAX()+1: under concurrency two transactions would read the same maximum
 * and produce a duplicate or a gap. The row lock serialises them — the second
 * transaction blocks until the first commits, then reads the updated value.
 */
async function nextJournalNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  periodId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO journal_counters (organization_id, period_id, last_number)
    VALUES (${organizationId}::uuid, ${periodId}::uuid, 0)
    ON CONFLICT (organization_id, period_id) DO NOTHING`;

  const rows = await tx.$queryRaw<Array<{ last_number: number }>>`
    SELECT last_number FROM journal_counters
    WHERE organization_id = ${organizationId}::uuid
      AND period_id = ${periodId}::uuid
    FOR UPDATE`;

  const current = rows[0];
  if (current === undefined) {
    throw new NotFoundError(
      `journal counter for period ${periodId} could not be allocated`,
    );
  }

  const next = current.last_number + 1;
  await tx.$executeRaw`
    UPDATE journal_counters SET last_number = ${next}
    WHERE organization_id = ${organizationId}::uuid
      AND period_id = ${periodId}::uuid`;
  return next;
}

async function requireOpenPeriod(
  tx: Prisma.TransactionClient,
  scope: LedgerScope,
  periodId: string,
): Promise<void> {
  const period = await tx.period.findFirst({
    where: { id: periodId, organizationId: scope.organizationId },
    select: { status: true },
  });
  if (period === null) {
    throw new NotFoundError(`period ${periodId} not found`);
  }
  if (period.status !== "OPEN") {
    throw new PeriodNotOpenError(
      `cannot post into period ${periodId}: status is ${period.status}`,
    );
  }
}

/**
 * Write a draft entry, its lines, then post it — all inside one transaction.
 *
 * The three statements cannot be collapsed. je_immutable forbids updating an
 * entry that is already posted, and jl_immutable forbids adding a line to one,
 * so an entry must be born as a draft and posted by an UPDATE. The deferred
 * constraint trigger je_balanced_check then fires at COMMIT, which is what
 * makes posting a real transaction boundary.
 */
async function writePostedEntry(
  tx: Prisma.TransactionClient,
  scope: LedgerScope,
  params: {
    periodId: string;
    entryDate: Date;
    description: string;
    currency: string;
    sourceModule: string;
    sourceId: string | null;
    reversalOfId: string | null;
    lines: NormalisedLine[];
  },
): Promise<PostedEntry> {
  const journalNumber = await nextJournalNumber(
    tx,
    scope.organizationId,
    params.periodId,
  );

  const entry = await tx.journalEntry.create({
    data: {
      organizationId: scope.organizationId,
      periodId: params.periodId,
      entryDate: params.entryDate,
      description: params.description,
      currency: params.currency,
      sourceModule: params.sourceModule,
      sourceId: params.sourceId,
      reversalOfId: params.reversalOfId,
    },
  });

  await tx.journalLine.createMany({
    data: params.lines.map((line, index) => ({
      organizationId: scope.organizationId,
      journalEntryId: entry.id,
      accountId: line.accountId,
      lineNumber: index + 1,
      debit: line.debit,
      credit: line.credit,
      currency: params.currency,
      fxRate: line.fxRate,
      reportingAmount: line.reportingAmount,
      memo: line.memo,
    })),
  });

  await tx.journalEntry.update({
    where: { id: entry.id },
    data: { postedAt: new Date(), postedBy: scope.userId, journalNumber },
  });

  return { entryId: entry.id, journalNumber };
}

export async function postJournalEntry(
  scope: LedgerScope,
  input: PostJournalInput,
): Promise<PostedEntry> {
  const lines = normaliseLines(input.lines);
  assertBalanced(lines);

  return withTx(async (tx) => {
    await requireOpenPeriod(tx, scope, input.periodId);

    // Every account must belong to this organization. The database trigger
    // jl_org_consistency enforces it as well; this turns a constraint
    // violation into a named error and avoids a pointless round trip.
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const found = await tx.account.findMany({
      where: { id: { in: accountIds }, organizationId: scope.organizationId },
      select: { id: true },
    });
    if (found.length !== accountIds.length) {
      const known = new Set(found.map((a) => a.id));
      const missing = accountIds.filter((id) => !known.has(id));
      throw new NotFoundError(`account(s) not found: ${missing.join(", ")}`);
    }

    const posted = await writePostedEntry(tx, scope, {
      periodId: input.periodId,
      entryDate: input.entryDate,
      description: input.description,
      currency: input.currency,
      sourceModule: input.sourceModule ?? "manual",
      sourceId: input.sourceId ?? null,
      reversalOfId: null,
      lines,
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.post",
        entityType: "JournalEntry",
        entityId: posted.entryId,
        after: {
          journalNumber: posted.journalNumber,
          periodId: input.periodId,
          lineCount: lines.length,
          currency: input.currency,
        },
      },
    });

    return posted;
  });
}

/**
 * Post the line-by-line inverse of an existing posted entry and link the two.
 *
 * Correction is never an edit — accounting-integrity I2. The original is left
 * exactly as it was apart from its reversed_by_id pointer.
 */
export async function reverseJournalEntry(
  scope: LedgerScope,
  originalId: string,
  asOfDate: Date,
): Promise<PostedEntry> {
  return withTx(async (tx) => {
    const original = await tx.journalEntry.findFirst({
      where: { id: originalId, organizationId: scope.organizationId },
      include: { journalLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (original === null) {
      throw new NotFoundError(`journal entry ${originalId} not found`);
    }
    if (original.postedAt === null) {
      throw new NotPostedError(
        `journal entry ${originalId} is a draft; only posted entries can be reversed`,
      );
    }
    if (original.reversedById !== null) {
      throw new AlreadyReversedError(
        `journal entry ${originalId} was already reversed by ${original.reversedById}`,
      );
    }

    // The reversal is posted into whichever period covers asOfDate, which may
    // differ from the original's period — that is the point of reversing "as
    // of" a date rather than in place.
    const period = await tx.period.findFirst({
      where: {
        organizationId: scope.organizationId,
        startDate: { lte: asOfDate },
        endDate: { gte: asOfDate },
      },
      select: { id: true, status: true },
    });
    if (period === null) {
      throw new NotFoundError(
        `no period covers ${asOfDate.toISOString().slice(0, 10)}`,
      );
    }
    if (period.status !== "OPEN") {
      throw new PeriodNotOpenError(
        `cannot post a reversal into period ${period.id}: status is ${period.status}`,
      );
    }

    const inverted: NormalisedLine[] = original.journalLines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      fxRate: line.fxRate,
      // Magnitude is unchanged by swapping debit and credit, so the reporting
      // amount is recomputed rather than copied — it must still satisfy
      // jl_reporting_amount_consistent.
      reportingAmount: reportingAmount(line.credit, line.debit, line.fxRate),
      memo: `reversal of line ${line.lineNumber}`,
    }));
    assertBalanced(inverted);

    const posted = await writePostedEntry(tx, scope, {
      periodId: period.id,
      entryDate: asOfDate,
      description: `Reversal of ${original.description}`,
      currency: original.currency,
      sourceModule: original.sourceModule,
      sourceId: original.sourceId,
      reversalOfId: original.id,
      lines: inverted,
    });

    // Raw SQL on purpose. je_immutable permits exactly one update to a posted
    // entry: setting reversed_by_id from NULL with every other column
    // unchanged. Prisma's @updatedAt would also bump updated_at, the trigger's
    // equality check would fail, and the update would be rejected.
    await tx.$executeRaw`
      UPDATE journal_entries SET reversed_by_id = ${posted.entryId}::uuid
      WHERE id = ${original.id}::uuid`;

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.reverse",
        entityType: "JournalEntry",
        entityId: original.id,
        before: { reversedById: null },
        after: {
          reversedById: posted.entryId,
          reversalJournalNumber: posted.journalNumber,
          periodId: period.id,
        },
      },
    });

    return posted;
  });
}

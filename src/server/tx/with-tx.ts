import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import type { TxClient } from "../db/client";

export type Isolation = "Serializable" | "RepeatableRead" | "ReadCommitted";
export interface WithTxOptions {
  isolation?: Isolation;
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * The current organization id, carried implicitly for the life of one
 * transaction.  The RLS policies on every organisation-scoped table filter on
 * `current_setting('app.current_organization')`, so this value must be set
 * before any query runs inside the transaction.
 *
 * `withTxUsing` sets it as a `SET LOCAL` at the top of each attempt, which
 * means it is scoped to the transaction and reset automatically when the
 * transaction ends — rolled back or committed.
 */
export interface WithTxContext {
  readonly organizationId: string;
}

export const RETRYABLE_SQLSTATES = ["40001", "40P01", "55P03"] as const;

function isRetryableCode(code: string): boolean {
  return RETRYABLE_SQLSTATES.includes(
    code as (typeof RETRYABLE_SQLSTATES)[number],
  );
}

/**
 * Returns true when the error's Postgres SQLSTATE is one of RETRYABLE_SQLSTATES.
 * Handles three shapes:
 *   1. Prisma.PrismaClientKnownRequestError — check e.meta?.code and e.code
 *   2. node-postgres error — check e.code
 *   3. Plain object with a code property
 */
export function isRetryableDbError(e: unknown): boolean {
  if (e == null || typeof e !== "object") {
    return false;
  }

  // Shape 1: Prisma.PrismaClientKnownRequestError
  const prismaErr = e as Prisma.PrismaClientKnownRequestError;
  if (typeof prismaErr.code === "string" && isRetryableCode(prismaErr.code)) {
    return true;
  }
  // meta.code is the pg code; meta may be undefined
  if (
    prismaErr.meta != null &&
    typeof prismaErr.meta === "object" &&
    "code" in prismaErr.meta
  ) {
    const metaCode = (prismaErr.meta as { code?: string }).code;
    if (typeof metaCode === "string" && isRetryableCode(metaCode)) {
      return true;
    }
  }

  // Shape 2 & 3: node-postgres or plain object with `code`
  const obj = e as Record<string, unknown>;
  if ("code" in obj && typeof obj.code === "string") {
    return isRetryableCode(obj.code);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` inside a Prisma transaction with retry logic.
 * Delegates to withTxUsing.
 *
 * The optional `context` carries the organization id so that every query
 * inside the transaction is subject to Row Level Security.  If the caller
 * omits it the transaction still runs (for tests that exercise raw-sql
 * paths or the retry loop itself), but RLS will refuse rows from other
 * tenants once the policies are live.
 */
export async function withTx<T>(
  fn: (tx: TxClient) => Promise<T>,
  opts: WithTxOptions = {},
  ctx?: WithTxContext,
): Promise<T> {
  return withTxUsing(
    async (innerFn, _isolation) => {
      return prisma.$transaction(innerFn, { isolationLevel: _isolation });
    },
    fn,
    opts,
    ctx,
  );
}

/**
 * Same retry loop as withTx but accepts a runner function so the retry logic
 * can be unit-tested without a database.
 *
 * If `context` is provided, sets `app.current_organization` at the top of
 * each attempt via a raw query inside the transaction.  `SET LOCAL` is
 * scoped to the transaction and is automatically reset when the
 * transaction ends.
 */
export async function withTxUsing<T>(
  runner: (
    fn: (tx: TxClient) => Promise<T>,
    isolation: Isolation,
  ) => Promise<T>,
  fn: (tx: TxClient) => Promise<T>,
  opts: WithTxOptions = {},
  ctx?: WithTxContext,
): Promise<T> {
  const isolation: Isolation = opts.isolation ?? "Serializable";
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 50;

  if (maxAttempts < 1) {
    throw new Error("maxAttempts must be >= 1");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runner(async (tx, _isolation) => {
        // Inject RLS context so every query inside the transaction is
        // scoped to the caller's organization.  SET LOCAL is scoped to
        // the transaction and resets automatically on commit/rollback.
        if (ctx?.organizationId) {
          await tx.$executeRawUnsafe(
            `SET LOCAL app.current_organization = '${ctx.organizationId}'`,
          );
        }
        return await fn(tx);
      }, isolation);
    } catch (e) {
      lastError = e;
      if (!isRetryableDbError(e) || attempt === maxAttempts) {
        throw e;
      }
      await sleep(
        baseDelayMs * attempt * attempt + Math.random() * baseDelayMs,
      );
    }
  }

  throw lastError;
}

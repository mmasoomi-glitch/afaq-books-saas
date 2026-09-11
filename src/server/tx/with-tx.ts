import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';

export type Isolation = 'Serializable' | 'RepeatableRead' | 'ReadCommitted';
export interface WithTxOptions {
  isolation?: Isolation;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export const RETRYABLE_SQLSTATES = ['40001', '40P01', '55P03'] as const;

function isRetryableCode(code: string): boolean {
  return RETRYABLE_SQLSTATES.includes(code as typeof RETRYABLE_SQLSTATES[number]);
}

/**
 * Returns true when the error's Postgres SQLSTATE is one of RETRYABLE_SQLSTATES.
 * Handles three shapes:
 *   1. Prisma.PrismaClientKnownRequestError — check e.meta?.code and e.code
 *   2. node-postgres error — check e.code
 *   3. Plain object with a code property
 */
export function isRetryableDbError(e: unknown): boolean {
  if (e == null || typeof e !== 'object') {
    return false;
  }

  // Shape 1: Prisma.PrismaClientKnownRequestError
  const prismaErr = e as Prisma.PrismaClientKnownRequestError;
  if (typeof prismaErr.code === 'string' && isRetryableCode(prismaErr.code)) {
    return true;
  }
  // meta.code is the pg code; meta may be undefined
  if (prismaErr.meta != null && typeof prismaErr.meta === 'object' && 'code' in prismaErr.meta) {
    const metaCode = (prismaErr.meta as { code?: string }).code;
    if (typeof metaCode === 'string' && isRetryableCode(metaCode)) {
      return true;
    }
  }

  // Shape 2 & 3: node-postgres or plain object with `code`
  const obj = e as Record<string, unknown>;
  if ('code' in obj && typeof obj.code === 'string') {
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
 */
export async function withTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: WithTxOptions = {}
): Promise<T> {
  return withTxUsing(
    async (innerFn, _isolation) => {
      return prisma.$transaction(innerFn, { isolationLevel: _isolation });
    },
    fn,
    opts
  );
}

/**
 * Same retry loop as withTx but accepts a runner function so the retry logic
 * can be unit-tested without a database.
 */
export async function withTxUsing<T>(
  runner: (fn: (tx: Prisma.TransactionClient) => Promise<T>, isolation: Isolation) => Promise<T>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: WithTxOptions = {}
): Promise<T> {
  const isolation: Isolation = opts.isolation ?? 'Serializable';
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 50;

  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be >= 1');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runner(fn, isolation);
    } catch (e) {
      lastError = e;
      if (!isRetryableDbError(e) || attempt === maxAttempts) {
        throw e;
      }
      await sleep(baseDelayMs * attempt * attempt + Math.random() * baseDelayMs);
    }
  }

  throw lastError;
}

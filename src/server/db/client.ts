import { PrismaClient } from "@prisma/client";
import { currentRequestId } from "../http/request-context";

/**
 * One PrismaClient for the process.
 *
 * Cached on globalThis so a development hot reload reuses the same client
 * instead of opening a new connection pool on every reload until the database
 * refuses connections.
 */

/**
 * Every `audit_logs` row gets the current request id, injected HERE rather than
 * at each of the eleven places one is written.
 *
 * `accounting-integrity.md` I9 requires the field. Adding it to eleven `data`
 * literals would work today and would be missing from the twelfth, because the
 * only thing telling the next person to include it is that everyone else did.
 * This repository has already paid for that lesson once, with the reserved-slug
 * list that needed extending twice in a session.
 *
 * Injected at the single point where an audit row is created, it cannot be
 * forgotten — including inside a `$transaction`, because a transaction started
 * from an extended client carries the extension with it. `R4` asserts that
 * rather than assuming it.
 *
 * `??=` rather than assignment: an explicit `requestId` passed by a caller
 * wins. Nothing does that today; a replay or an import tool would want to.
 */
function extend(base: PrismaClient) {
  return base.$extends({
    query: {
      auditLog: {
        create({ args, query }) {
          args.data = { requestId: currentRequestId() ?? null, ...args.data };
          return query(args);
        },
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof extend>;

/**
 * The BASE client is cached, not the extended one — and that distinction is a
 * bug I introduced and a test caught.
 *
 * What is worth caching is the connection pool: without it, every hot reload
 * opens a new one until Postgres refuses connections. The extension is cheap
 * and is rebuilt per module instance.
 *
 * Caching the EXTENDED client is wrong because the extension closes over
 * `currentRequestId`, which belongs to whichever instance of
 * `request-context.ts` was loaded when that client was built. A second module
 * instance — a hot reload, or Vitest's per-file module registry — then reuses a
 * client whose extension reads an `AsyncLocalStorage` that nobody is writing
 * to. Every request id silently becomes null.
 *
 * That is exactly how it failed: three tests passed when their file ran alone
 * and failed when another file had loaded the client first. The `globalThis`
 * cache outlives module isolation; the module-level closure does not.
 */
const globalForPrisma = globalThis as unknown as {
  afaqPrismaBase?: PrismaClient;
};

const base = globalForPrisma.afaqPrismaBase ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.afaqPrismaBase = base;
}

export const prisma: ExtendedClient = extend(base);

export type { PrismaClient } from "@prisma/client";

/**
 * The transaction client as seen through the EXTENSION.
 *
 * `Prisma.TransactionClient` describes a transaction on a bare client and no
 * longer matches: the extension changes the shape, and typecheck says so.
 * Deriving it from `prisma` itself means it tracks any future extension
 * automatically rather than needing to be remembered.
 */
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

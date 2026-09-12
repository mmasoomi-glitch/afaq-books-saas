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

const globalForPrisma = globalThis as unknown as {
  afaqPrisma?: ExtendedClient;
};

export const prisma: ExtendedClient =
  globalForPrisma.afaqPrisma ?? extend(new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.afaqPrisma = prisma;
}

export type { PrismaClient } from "@prisma/client";

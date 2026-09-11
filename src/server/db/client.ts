import { PrismaClient } from "@prisma/client";

/**
 * One PrismaClient for the process.
 *
 * Cached on globalThis so a development hot reload reuses the same client
 * instead of opening a new connection pool on every reload until the database
 * refuses connections.
 */
const globalForPrisma = globalThis as unknown as {
  afaqPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.afaqPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.afaqPrisma = prisma;
}

export type { PrismaClient } from "@prisma/client";

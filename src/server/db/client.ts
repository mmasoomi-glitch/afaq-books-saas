import { PrismaClient as PrismaClientRaw } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: NonNullable<typeof prismaGlobal> | undefined;
}

const prismaGlobal = globalThis as typeof globalThis & {
  prismaGlobal?: PrismaClientRaw;
};

const prisma = prismaGlobal.prismaGlobal ?? new PrismaClientRaw();

if (process.env.NODE_ENV !== "production") prismaGlobal.prismaGlobal = prisma;

export { prisma };
export type { PrismaClient } from "@prisma/client";

import type { Account } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { TxClient } from "../../server/db/client";
import { withTx } from "../../server/tx/with-tx";
import type { CreateAccountInput, LedgerScope } from "./scope";
import { NotFoundError } from "./errors";

export async function createAccount(
  scope: LedgerScope,
  input: CreateAccountInput,
): Promise<Account> {
  return withTx(async (tx: TxClient) => {
    if (input.parentId !== undefined) {
      // A parent from another organization would be a cross-tenant link.
      const parent = await tx.account.findFirst({
        where: { id: input.parentId, organizationId: scope.organizationId },
        select: { id: true },
      });
      if (parent === null) {
        throw new NotFoundError(`account ${input.parentId} not found`);
      }
    }

    const account = await tx.account.create({
      data: {
        organizationId: scope.organizationId,
        code: input.code,
        name: input.name,
        type: input.type,
        currency: input.currency,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorId: scope.userId,
        action: "ledger.account.create",
        entityType: "Account",
        entityId: account.id,
        after: { code: account.code, name: account.name, type: account.type },
      },
    });

    return account;
  });
}

/** Org-scoped. There is no "all accounts" view; see accounting-integrity I7. */
export async function listAccounts(scope: LedgerScope): Promise<Account[]> {
  return prisma.account.findMany({
    where: { organizationId: scope.organizationId },
    orderBy: { code: "asc" },
  });
}

/**
 * Returns null when the account does not exist OR belongs to another
 * organization. Deliberately the same answer for both: a distinct error for
 * "exists but not yours" tells a caller that another tenant holds that id.
 */
export async function getAccount(
  scope: LedgerScope,
  accountId: string,
): Promise<Account | null> {
  return prisma.account.findFirst({
    where: { id: accountId, organizationId: scope.organizationId },
  });
}

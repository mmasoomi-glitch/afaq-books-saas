import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import type { LedgerScope } from "../ledger/scope";
import { NotFoundError } from "../ledger/errors";

// ── Types ───────────────────────────────────────────────────────────────

export type RuleActionType = "CATEGORIZE" | "FLAG" | "CLASSIFY";

export interface CreateRuleInput {
  bankAccountId: string | null;
  description: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  actionType: RuleActionType;
  actionTarget: string;
  priority: number;
  isActive: boolean;
}

export interface UpdateRuleInput {
  description?: string;
  conditionField?: string;
  conditionOperator?: string;
  conditionValue?: string;
  actionType?: RuleActionType;
  actionTarget?: string;
  priority?: number;
  isActive?: boolean;
}

export interface CategorizationRuleSummary {
  id: string;
  organizationId: string;
  bankAccountId: string | null;
  description: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  actionType: string;
  actionTarget: string;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Errors ──────────────────────────────────────────────────────────────

export class RuleError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class RuleNotFoundError extends RuleError {
  constructor(id: string) {
    super(`rule ${id} not found`, "BANKING_RULE_NOT_FOUND");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function toSummary(row: {
  id: string;
  organizationId: string;
  bankAccountId: string | null;
  description: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  actionType: string;
  actionTarget: string;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CategorizationRuleSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    bankAccountId: row.bankAccountId,
    description: row.description,
    conditionField: row.conditionField,
    conditionOperator: row.conditionOperator,
    conditionValue: row.conditionValue,
    actionType: row.actionType,
    actionTarget: row.actionTarget,
    priority: row.priority,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Service functions ───────────────────────────────────────────────────

/**
 * Create a bank feed categorization rule.
 */
export async function createRule(
  scope: LedgerScope,
  input: CreateRuleInput,
): Promise<CategorizationRuleSummary> {
  // Verify bank account belongs to org (if specified).
  if (input.bankAccountId !== null) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: scope.organizationId },
    });
    if (account === null) {
      throw new NotFoundError(
        `bank account ${input.bankAccountId} not found`,
      );
    }
  }

  const row = await prisma.bankFeedRule.create({
    data: {
      organizationId: scope.organizationId,
      bankAccountId: input.bankAccountId,
      description: input.description,
      conditionField: input.conditionField,
      conditionOperator: input.conditionOperator,
      conditionValue: input.conditionValue,
      actionType: input.actionType as Prisma.EnumRuleActionType,
      actionTarget: input.actionTarget,
      priority: input.priority,
      isActive: input.isActive,
    },
  });

  return toSummary(row);
}

/**
 * Update a categorization rule.
 */
export async function updateRule(
  scope: LedgerScope,
  ruleId: string,
  input: UpdateRuleInput,
): Promise<CategorizationRuleSummary> {
  const existing = await prisma.bankFeedRule.findFirst({
    where: { id: ruleId, organizationId: scope.organizationId },
  });
  if (existing === null) {
    throw new RuleNotFoundError(ruleId);
  }

  const updated = await prisma.bankFeedRule.update({
    where: { id: ruleId },
    data: {
      description: input.description ?? existing.description,
      conditionField: input.conditionField ?? existing.conditionField,
      conditionOperator: input.conditionOperator ?? existing.conditionOperator,
      conditionValue: input.conditionValue ?? existing.conditionValue,
      actionType: input.actionType
        ? (input.actionType as Prisma.EnumRuleActionType)
        : existing.actionType,
      actionTarget: input.actionTarget ?? existing.actionTarget,
      priority: input.priority ?? existing.priority,
      isActive: input.isActive ?? existing.isActive,
    },
  });

  return toSummary(updated);
}

/**
 * Delete a categorization rule.
 */
export async function deleteRule(
  scope: LedgerScope,
  ruleId: string,
): Promise<void> {
  const existing = await prisma.bankFeedRule.findFirst({
    where: { id: ruleId, organizationId: scope.organizationId },
  });
  if (existing === null) {
    throw new RuleNotFoundError(ruleId);
  }

  await prisma.bankFeedRule.delete({ where: { id: ruleId } });
}

/**
 * List all categorization rules for an org, optionally filtered by bank account.
 */
export async function listRules(
  scope: LedgerScope,
  bankAccountId?: string,
): Promise<CategorizationRuleSummary[]> {
  const where: Prisma.BankFeedRuleWhereInput = {
    organizationId: scope.organizationId,
    ...(bankAccountId !== undefined ? { bankAccountId } : {}),
  };

  const rules = await prisma.bankFeedRule.findMany({
    where,
    orderBy: [{ isActive: "desc" }, { priority: "desc" }],
  });

  return rules.map(toSummary);
}

/**
 * Test a rule against a transaction description without persisting.
 *
 * Returns whether the rule would match and what action it would take.
 */
export async function testRule(
  ruleId: string,
  description: string,
): Promise<{
  matches: boolean;
  description: string;
  actionType: string;
  actionTarget: string;
}> {
  const rule = await prisma.bankFeedRule.findFirst({
    where: { id: ruleId, isActive: true },
    select: {
      description: true,
      conditionField: true,
      conditionOperator: true,
      conditionValue: true,
      actionType: true,
      actionTarget: true,
    },
  });

  if (rule === null) {
    return {
      matches: false,
      description: "rule not found",
      actionType: "",
      actionTarget: "",
    };
  }

  const matches = matchesCondition(
    description,
    rule.conditionField,
    rule.conditionOperator,
    rule.conditionValue,
  );

  return {
    matches,
    description: rule.description,
    actionType: rule.actionType,
    actionTarget: rule.actionTarget,
  };
}

function matchesCondition(
  value: string,
  conditionField: string,
  conditionOperator: string,
  conditionValue: string,
): boolean {
  if (conditionField !== "description") return false;

  switch (conditionOperator) {
    case "contains":
      return value.toLowerCase().includes(conditionValue.toLowerCase());
    case "equals":
      return value.toLowerCase() === conditionValue.toLowerCase();
    case "regex":
      try {
        const re = new RegExp(conditionValue, "i");
        return re.test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

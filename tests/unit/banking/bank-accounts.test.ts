import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/server/db/client";
import { OrgScope } from "../../../src/server/auth/scope";
import { setupTestOrg, type TestOrg } from "../../../tests/setup";
import {
  createBankAccount,
  getBankAccount,
  listBankAccounts,
  updateBankAccount,
  deactivateBankAccount,
  getBankAccountSummary,
  setupOpeningBalance,
  BankAccountNotFoundError,
} from "../../../src/modules/banking/bank-accounts";
import type { BankAccountSummary, CreateBankAccountInput, UpdateBankAccountInput } from "../../../src/modules/banking/bank-accounts";

let org: TestOrg;
let scope: OrgScope;
let ledgerScope: { organizationId: string; userId: string };

beforeEach(async () => {
  org = await setupTestOrg();
  scope = {
    userId: org.ownerId,
    organizationId: org.id,
    role: "owner",
    permissions: new Set(["all"]),
  };
  ledgerScope = {
    organizationId: org.id,
    userId: org.ownerId,
    orgId: org.id,
    role: "owner",
    permissions: new Set(["all"]),
  };
});

describe("bank-accounts", () => {
  describe("createBankAccount", () => {
    it("creates a new bank account", async () => {
      const input: CreateBankAccountInput = {
        name: "Test Bank Account",
        accountNumber: "1234567890",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);

      expect(account.name).toBe("Test Bank Account");
      expect(account.institutionName).toBe("Test Bank");
      expect(account.currency).toBe("USD");
      expect(account.isActive).toBe(true);
      expect(account.createdAt).toBeInstanceOf(Date);
    });

    it("stores account number masked in summary", async () => {
      const input: CreateBankAccountInput = {
        name: "Test Bank Account",
        accountNumber: "1234567890",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      const summary = await getBankAccount(ledgerScope, account.id);

      expect(summary).not.toBeNull();
      expect(summary!.accountNumberMasked).toBe("****7890");
    });

    it("rejects duplicate external account identifiers within the same org", async () => {
      const input: CreateBankAccountInput = {
        name: "First Account",
        accountNumber: "unique-id-1",
        institutionName: "Test Bank",
        currency: "USD",
      };

      await createBankAccount(ledgerScope, input);

      const input2: CreateBankAccountInput = {
        name: "Second Account",
        accountNumber: "unique-id-1",
        institutionName: "Different Bank",
        currency: "USD",
      };

      await expect(createBankAccount(ledgerScope, input2)).rejects.toThrow(
        "BANKING_ACCOUNT_DUPLICATE",
      );
    });
  });

  describe("getBankAccount", () => {
    it("returns null for non-existent account", async () => {
      const account = await getBankAccount(ledgerScope, "00000000-0000-0000-0000-000000000000");
      expect(account).toBeNull();
    });

    it("returns account by id", async () => {
      const input: CreateBankAccountInput = {
        name: "Get Test Account",
        accountNumber: "GET123",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      const retrieved = await getBankAccount(ledgerScope, account.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("Get Test Account");
      expect(retrieved!.id).toBe(account.id);
    });
  });

  describe("listBankAccounts", () => {
    it("returns all active accounts for the org", async () => {
      await createBankAccount(ledgerScope, {
        name: "Account 1",
        accountNumber: "ACC1",
        institutionName: "Bank 1",
        currency: "USD",
      });
      await createBankAccount(ledgerScope, {
        name: "Account 2",
        accountNumber: "ACC2",
        institutionName: "Bank 2",
        currency: "EUR",
      });

      const accounts = await listBankAccounts(ledgerScope);

      expect(accounts).toHaveLength(2);
      expect(accounts.every((a) => a.isActive)).toBe(true);
    });

    it("excludes deactivated accounts", async () => {
      const input: CreateBankAccountInput = {
        name: "Deactivate Test",
        accountNumber: "DEACT1",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      await deactivateBankAccount(ledgerScope, account.id);

      const accounts = await listBankAccounts(ledgerScope);

      expect(accounts).toHaveLength(0);
    });
  });

  describe("updateBankAccount", () => {
    it("updates account details", async () => {
      const input: CreateBankAccountInput = {
        name: "Original Name",
        accountNumber: "UPD1",
        institutionName: "Original Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);

      const update: UpdateBankAccountInput = {
        name: "Updated Name",
        institutionName: "Updated Bank",
      };

      const updated = await updateBankAccount(ledgerScope, account.id, update);

      expect(updated.name).toBe("Updated Name");
      expect(updated.institutionName).toBe("Updated Bank");
    });
  });

  describe("deactivateBankAccount", () => {
    it("deactivates an account", async () => {
      const input: CreateBankAccountInput = {
        name: "Deactivate Test",
        accountNumber: "DEACT2",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      await deactivateBankAccount(ledgerScope, account.id);

      const retrieved = await getBankAccount(ledgerScope, account.id);
      expect(retrieved?.isActive).toBe(false);
    });

    it("removes account from list", async () => {
      const input: CreateBankAccountInput = {
        name: "Deactivate Test 2",
        accountNumber: "DEACT3",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      await deactivateBankAccount(ledgerScope, account.id);

      const accounts = await listBankAccounts(ledgerScope);
      expect(accounts).toHaveLength(0);
    });
  });

  describe("getBankAccountSummary", () => {
    it("returns summary with zero balances for new account", async () => {
      const input: CreateBankAccountInput = {
        name: "Summary Test",
        accountNumber: "SUM1",
        institutionName: "Test Bank",
        currency: "USD",
      };

      const account = await createBankAccount(ledgerScope, input);
      const summary = await getBankAccountSummary(ledgerScope, account.id);

      expect(summary.id).toBe(account.id);
      expect(summary.name).toBe("Summary Test");
      expect(summary.closingBalance).toBe("0.0000");
    });

    it("throws for non-existent account", async () => {
      await expect(
        getBankAccountSummary(ledgerScope, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(BankAccountNotFoundError);
    });
  });
});

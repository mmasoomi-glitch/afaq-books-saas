import type { AccountType } from "@prisma/client";
import { json } from "../types";
import type { HttpResponse } from "../types";
import { error } from "../types";
import { verifyCsrf } from "../csrf";
import { readString } from "./scoped";
import type { ScopedHandler } from "./scoped";
import { toErrorResponse } from "./auth";
import {
  guardedCreateAccount,
  guardedCreatePeriod,
  guardedPostJournalEntry,
} from "../../../modules/ledger/guarded";
import type { PostLineInput } from "../../../modules/ledger/posting";

/**
 * Ledger endpoints.
 *
 * Every one runs behind `withOrgScope`, so the caller's membership has been
 * re-resolved on this request before any of these functions execute, and every
 * one delegates to a `guarded*` wrapper that asserts the action before it
 * touches the database. Nothing here calls an unguarded service — CI enforces
 * that with a grep, and it would be the obvious shortcut.
 */

const ACCOUNT_TYPES: readonly AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];

function readAccountType(body: unknown): AccountType | undefined {
  const raw = readString(body, "type");
  if (raw === undefined) return undefined;
  return ACCOUNT_TYPES.find((type) => type === raw);
}

/**
 * A three-letter ISO currency code, upper-cased.
 *
 * `accounts.currency` is `CHAR(3)`, so a longer value would be truncated or
 * rejected by Postgres depending on the driver — neither of which is a message
 * anybody can act on. Checking the shape here turns it into a 400 that says
 * what is wrong.
 *
 * The code is NOT checked against a list of real currencies. That list changes,
 * and a product that refuses a legitimate currency because its table is out of
 * date is worse than one that accepts a typo the user can see and fix.
 */
function readCurrency(body: unknown): string | undefined {
  const raw = readString(body, "currency");
  if (raw === undefined) return undefined;
  const upper = raw.toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

function badBody(message: string): HttpResponse {
  return error(400, "INVALID_BODY", message);
}

/**
 * A duplicate account code is a CONFLICT the caller can fix, not a bug.
 *
 * `createAccount` lets the `(organization_id, code)` unique constraint do the
 * work rather than checking first — a check-then-insert races two concurrent
 * creations into the same code. But `toErrorResponse` rethrows anything it does
 * not recognise, so without this the violation would surface as a 500 and the
 * user would be told "something went wrong" about something they can correct in
 * five seconds.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}

/**
 * The ledger invariants live in the DATABASE, and the ones a user can trip are
 * facts about what they submitted — not bugs.
 *
 * Found by posting a deliberately unbalanced entry against the running server:
 * it was correctly refused, and answered **500 "internal error"**. The refusal
 * was right and the status was wrong. `toErrorResponse` rethrows what it does
 * not recognise, so a constraint violation fell through to the adapter's
 * catch-all, and the caller was told nothing they could act on.
 *
 * 422 rather than 400: the body was well-formed and every field was the right
 * type. What failed was a rule about the relationship between the fields, which
 * is precisely what 422 means.
 *
 * The messages name what the USER did, never the constraint. "Debits do not
 * equal credits" is a fact about their entry; `je_balanced_check` is a fact
 * about our schema, and the second is not theirs to know.
 *
 * Anything NOT in this table still becomes a 500, deliberately. A constraint
 * nobody anticipated is a bug until somebody decides otherwise, and quietly
 * turning every database error into a 422 would hide the next real one.
 */
const LEDGER_REFUSALS: readonly {
  readonly constraint: string;
  readonly code: string;
  readonly message: string;
}[] = [
  {
    constraint: "je_balanced_check",
    code: "ENTRY_UNBALANCED",
    message: "debits do not equal credits",
  },
  {
    constraint: "je_period_open",
    code: "PERIOD_NOT_OPEN",
    message: "that accounting period is closed or locked",
  },
  {
    constraint: "jl_org_consistency",
    code: "ACCOUNT_NOT_IN_ORGANIZATION",
    message: "one of the accounts does not belong to this organization",
  },
  {
    constraint: "jl_debit_credit_sign",
    code: "LINE_INVALID",
    message: "a line must have exactly one of debit or credit, and it must be positive",
  },
  {
    constraint: "jl_nonzero",
    code: "LINE_INVALID",
    message: "a line cannot be zero on both sides",
  },
  {
    constraint: "period_no_overlap",
    code: "PERIOD_OVERLAPS",
    message: "that period overlaps one that already exists",
  },
  {
    constraint: "je_immutable",
    code: "ENTRY_IMMUTABLE",
    message: "a posted entry cannot be changed; post a reversal instead",
  },
  {
    constraint: "jl_immutable",
    code: "ENTRY_IMMUTABLE",
    message: "a posted entry cannot be changed; post a reversal instead",
  },
];

function ledgerRefusal(err: unknown): HttpResponse | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const text = "message" in err ? String(err.message) : "";

  const match = LEDGER_REFUSALS.find((refusal) =>
    text.includes(refusal.constraint),
  );
  return match === undefined
    ? undefined
    : error(422, match.code, match.message);
}

function guarded(handler: ScopedHandler): ScopedHandler {
  return async (req, scope) => {
    try {
      verifyCsrf(req);
      return await handler(req, scope);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return error(409, "ALREADY_EXISTS", "that code is already in use");
      }

      const refusal = ledgerRefusal(err);
      if (refusal !== undefined) return refusal;

      return toErrorResponse(err);
    }
  };
}

/** `POST /api/[orgSlug]/accounts` — add an account to the chart. */
export function createAccountHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const code = readString(req.body, "code");
    const name = readString(req.body, "name");
    const type = readAccountType(req.body);
    const currency = readCurrency(req.body);

    if (
      code === undefined ||
      name === undefined ||
      type === undefined ||
      currency === undefined
    ) {
      return badBody(
        "code, name, a valid type and a three-letter currency are required",
      );
    }

    const account = await guardedCreateAccount(scope, {
      code,
      name,
      type,
      currency,
    });

    return json(201, {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currency: account.currency,
    });
  });
}

/** `POST /api/[orgSlug]/periods` — open an accounting period. */
export function createPeriodHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const name = readString(req.body, "name");
    const start = readString(req.body, "startDate");
    const end = readString(req.body, "endDate");

    if (name === undefined || start === undefined || end === undefined) {
      return badBody("name, startDate and endDate are required");
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Checked here rather than left to Postgres. An `Invalid Date` reaches the
    // driver as NULL or as a cast failure depending on the path, and the period
    // non-overlap EXCLUSION constraint would then reject it for a reason that
    // has nothing to do with what the user typed.
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return badBody("startDate and endDate must be dates (YYYY-MM-DD)");
    }

    const period = await guardedCreatePeriod(scope, {
      name,
      startDate,
      endDate,
    });

    return json(201, {
      id: period.id,
      name: period.name,
      status: period.status,
    });
  });
}

/**
 * An amount from a form field, as a STRING.
 *
 * Never `Number(raw)`. `accounting-integrity.md` I8 forbids a JavaScript float
 * anywhere near a stored amount, and the round trip through one is lossy in
 * exactly the range money lives in: `0.1 + 0.2` is the canonical example, and a
 * ledger that is out by a ten-thousandth does not balance.
 *
 * So the string is validated for SHAPE and passed through untouched.
 * `Prisma.Decimal` parses it on the other side. The regex allows up to four
 * decimal places because that is the column's scale — more would be silently
 * rounded by Postgres, and a silently rounded amount in a journal line is the
 * difference between a balanced entry and an unbalanced one.
 */
function readAmount(
  value: unknown,
): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") return { ok: false };

  const trimmed = value.trim();
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * One journal line, narrowed field by field.
 *
 * Returns `undefined` for anything malformed rather than throwing, so the
 * caller can answer 400 once for the whole request instead of leaking which
 * line was wrong in an exception message.
 */
function readLine(raw: unknown): PostLineInput | undefined {
  const accountId = readString(raw, "accountId");
  if (accountId === undefined) return undefined;

  const debitRaw = Object.getOwnPropertyDescriptor(raw, "debit")?.value;
  const creditRaw = Object.getOwnPropertyDescriptor(raw, "credit")?.value;

  const debit = readAmount(debitRaw);
  const credit = readAmount(creditRaw);
  if (!debit.ok || !credit.ok) return undefined;

  // Exactly one side. Both populated, or neither, is rejected here as well as
  // by `jl_debit_credit_sign` and `jl_nonzero` in the database — this copy
  // exists to make the message useful, not to be the enforcement.
  const hasDebit = debit.value !== undefined;
  const hasCredit = credit.value !== undefined;
  if (hasDebit === hasCredit) return undefined;

  const memo = readString(raw, "memo");
  return {
    accountId,
    ...(debit.value === undefined ? {} : { debit: debit.value }),
    ...(credit.value === undefined ? {} : { credit: credit.value }),
    ...(memo === undefined ? {} : { memo }),
  };
}

/** `POST /api/[orgSlug]/entries` — post a balanced journal entry. */
export function postEntryHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const periodId = readString(req.body, "periodId");
    const description = readString(req.body, "description");
    const currency = readCurrency(req.body);
    const dateRaw = readString(req.body, "entryDate");

    if (
      periodId === undefined ||
      description === undefined ||
      currency === undefined ||
      dateRaw === undefined
    ) {
      return badBody(
        "periodId, entryDate, description and a three-letter currency are required",
      );
    }

    const entryDate = new Date(dateRaw);
    if (Number.isNaN(entryDate.getTime())) {
      return badBody("entryDate must be a date (YYYY-MM-DD)");
    }

    const rawLines = Object.getOwnPropertyDescriptor(req.body, "lines")?.value;
    if (!Array.isArray(rawLines)) return badBody("lines must be an array");

    // Two lines is the minimum that can balance. One line cannot, and an entry
    // with none is not an entry — both would be refused by the deferred balance
    // trigger at COMMIT, but the message there names a constraint rather than
    // the thing the user did.
    if (rawLines.length < 2) return badBody("an entry needs at least two lines");

    const lines: PostLineInput[] = [];
    for (const raw of rawLines) {
      const line = readLine(raw);
      if (line === undefined) {
        return badBody(
          "each line needs an accountId and exactly one of debit or credit, " +
            "as a number with at most four decimal places",
        );
      }
      lines.push(line);
    }

    // NOT checked here: that the entry balances. `je_balanced_check` is a
    // DEFERRABLE constraint trigger evaluated at COMMIT, and that is the only
    // place the question has a trustworthy answer — a sum computed in this
    // process is a claim about what we intend to write, not about what was
    // written. Re-implementing it would mean two answers that can disagree, and
    // the one users would see is the wrong one.
    const posted = await guardedPostJournalEntry(scope, {
      periodId,
      entryDate,
      description,
      currency,
      lines,
    });

    return json(201, {
      entryId: posted.entryId,
      journalNumber: posted.journalNumber,
    });
  });
}

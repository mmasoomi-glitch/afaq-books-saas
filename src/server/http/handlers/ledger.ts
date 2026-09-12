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
} from "../../../modules/ledger/guarded";

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

function guarded(handler: ScopedHandler): ScopedHandler {
  return async (req, scope) => {
    try {
      verifyCsrf(req);
      return await handler(req, scope);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return error(409, "ALREADY_EXISTS", "that code is already in use");
      }
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

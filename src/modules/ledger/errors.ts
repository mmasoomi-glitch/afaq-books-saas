/**
 * Named ledger errors. Every failure path throws one of these, never a bare
 * `new Error('failed')` — callers (and tests) need to distinguish "you sent me
 * an unbalanced entry" from "that period is locked" from "I could not find it".
 */
export class LedgerError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

/** The entity does not exist, or belongs to another organization. The two are
 *  deliberately indistinguishable: telling a caller "it exists but is not
 *  yours" leaks the existence of another tenant's row. */
export class NotFoundError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_NOT_FOUND");
  }
}

export class UnbalancedEntryError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_UNBALANCED");
  }
}

export class PeriodNotOpenError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_PERIOD_NOT_OPEN");
  }
}

export class AlreadyReversedError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_ALREADY_REVERSED");
  }
}

export class NotPostedError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_NOT_POSTED");
  }
}

/**
 * No accounting period covers the requested date.
 *
 * Deliberately NOT a `NotFoundError`, even though the lookup that produced it
 * returned nothing. "That entry does not exist" and "you have no period
 * covering 13 September" are different facts: the first may be an attempt to
 * reach another tenant's row and must stay opaque, the second is a gap in the
 * caller's own books that only they can fix.
 *
 * Sharing one code made a reversal answer 404 "not found" when the real
 * problem was that nobody had opened a period for the current year — a message
 * that sends the user looking for a missing entry instead of at their period
 * list.
 */
export class NoPeriodForDateError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_NO_PERIOD_FOR_DATE");
  }
}

export class InvalidLineError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_INVALID_LINE");
  }
}

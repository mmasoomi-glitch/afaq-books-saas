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

export class InvalidLineError extends LedgerError {
  constructor(message: string) {
    super(message, "LEDGER_INVALID_LINE");
  }
}

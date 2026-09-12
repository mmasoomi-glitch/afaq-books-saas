import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * The request id, carried implicitly for the life of one request.
 *
 * `accounting-integrity.md` I9 lists `request id` among the fields an audit row
 * stores, and it has been null on every row since the table existed.
 *
 * **Why this is ambient rather than a parameter.** The explicit alternative is
 * to thread a context argument through about twelve signatures — every handler,
 * every guarded wrapper, every service that writes an audit row. That works,
 * and it has one failure mode: the next person to add an audited action has to
 * remember to thread it, and the only thing telling them is that everyone else
 * did.
 *
 * This repository already learned that lesson from the reserved-slug list: a
 * value that must be added in N places by attention alone is a value that will
 * eventually be missing from the N+1th. `AsyncLocalStorage` cannot be
 * forgotten, because nothing has to remember it.
 *
 * **What it costs, stated plainly.** It is invisible at the call site. Someone
 * reading `auditLog.create` will not see where `requestId` comes from, which is
 * exactly the objection to ambient state — so the Prisma extension that injects
 * it says so, and this file is the one place that explains it.
 *
 * A service called outside a request — a test, a future scheduled job — has no
 * id, and gets `null`. That is correct: there was no request.
 */

interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** A fresh id. UUIDv4 — it only has to be unique, not unguessable. */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Run `fn` with `requestId` in scope for everything it awaits.
 *
 * The adapter wraps the whole handler in this, so every query the request makes
 * — including ones inside a Prisma transaction several layers down — sees it.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** The current request id, or `undefined` outside a request. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

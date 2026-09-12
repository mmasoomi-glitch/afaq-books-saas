import type { HttpHandler, HttpRequest, HttpResponse } from "../types";
import { error, json } from "../types";
import { timingSafeStringEqual } from "../csrf";
import { reapExpired } from "../../auth/rate-limit";

/**
 * Maintenance, for an external scheduler to call.
 *
 * Chosen over `pg_cron` and over opportunistic cleanup in the request path.
 * `pg_cron` needs an extension and `shared_preload_libraries` in every
 * environment including CI, and is silently absent when it is missing.
 * Probabilistic cleanup inside `checkAndConsume` puts a variable-latency
 * DELETE in a request a user is waiting on, and does nothing at all when
 * traffic is low — which is exactly when rows accumulate unnoticed.
 *
 * An endpoint is visible, testable, and fails in a way somebody can see.
 */

export const MAINTENANCE_HEADER = "x-maintenance-secret";

/**
 * The shortest configured secret this endpoint will honour.
 *
 * The empty-string guard below started as a check for `MAINTENANCE_SECRET=` in
 * a `.env` file. A review pointed out it did not cover `MAINTENANCE_SECRET="  "`
 * — whitespace is neither `undefined` nor `""`, so a caller sending the same
 * whitespace would have been authorised. Rather than add a second special case,
 * the rule is now a length floor after trimming, which covers both and also
 * covers `MAINTENANCE_SECRET=x`.
 *
 * 32 matches what `security-tenancy.md` asks of `AUTH_SECRET`, and matters more
 * here than the low value of the endpoint suggests: nothing rate-limits this
 * route, so a short secret can be guessed at whatever speed the network allows.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * A missing secret and a wrong secret answer IDENTICALLY: 404.
 *
 * The tempting alternative is 503 "not configured", which is more helpful to
 * an operator — and tells an attacker whether this deployment has maintenance
 * set up, which is a fact about our operational maturity they have no business
 * having. The operator gets a loud server-side log instead, which is where
 * they are looking anyway.
 *
 * 404 rather than 401 for the same reason every scoped route uses it: an
 * unauthenticated caller should not learn that the route exists.
 */
function authorised(req: HttpRequest): boolean {
  const configured = process.env["MAINTENANCE_SECRET"];

  if (
    configured === undefined ||
    configured.trim().length < MIN_SECRET_LENGTH
  ) {
    console.warn(
      "[maintenance] MAINTENANCE_SECRET is unset, blank or shorter than " +
        `${String(MIN_SECRET_LENGTH)} characters; the reaper endpoint is ` +
        "refusing every request. Expired rate_limits rows will accumulate.",
    );
    return false;
  }

  // Fails closed, and silently from the caller's side, so say it out loud. A
  // value with surrounding whitespace is easy to end up with — a trailing space
  // in a `.env` file, a secret pasted with a newline — and the scheduler that
  // sends the trimmed value it was given will just get 404 forever.
  if (configured !== configured.trim()) {
    console.warn(
      "[maintenance] MAINTENANCE_SECRET has leading or trailing whitespace. " +
        "It is compared exactly, so a caller sending the trimmed value will " +
        "be refused.",
    );
  }

  const supplied = req.headers[MAINTENANCE_HEADER];
  if (supplied === undefined || supplied === "") return false;

  // Constant time, like the CSRF comparison and for the same reason: `===`
  // returns as soon as two bytes differ, and this secret is long-lived.
  return timingSafeStringEqual(configured, supplied);
}

/**
 * `POST /api/maintenance/reap` — remove expired rate-limit counters.
 *
 * POST rather than GET because it changes state, and because a GET would be
 * fetched by any crawler or link preview that found the URL.
 *
 * No CSRF check: there is no cookie and no browser here. The shared secret IS
 * the authentication, and a cross-origin page cannot set a custom header
 * without a preflight this server does not answer.
 *
 * `audit_logs` is deliberately NOT touched. It is append-only by trigger and
 * deleting from it would contradict the reason it exists; retention there means
 * archiving to colder storage, which is a decision rather than a job. See
 * B-20260913-02.
 */
export function reapHandler(): HttpHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "POST") {
      return error(405, "METHOD_NOT_ALLOWED", "POST required", {
        headers: { allow: "POST" },
      });
    }

    if (!authorised(req)) {
      return error(404, "NOT_FOUND", "not found");
    }

    const removed = await reapExpired();

    // The count is returned so the scheduler's own logs show whether the job is
    // doing anything. A maintenance endpoint that always answers "ok" is
    // indistinguishable from one that silently stopped working.
    return json(200, { removed });
  };
}

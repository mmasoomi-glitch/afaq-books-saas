import type { AdapterConfig } from "./adapters/web";
import type { AuthHandlerConfig } from "./handlers/auth";

/**
 * The two settings that cannot be guessed from inside the process, read once
 * from the environment.
 *
 * Both default to the SAFE value when unset, and "safe" here means "the control
 * is weaker but nothing is silently forged". That direction matters: the
 * failure mode of the opposite default is a control that appears to work and
 * does not.
 */

/**
 * Whether `x-forwarded-for` may be believed.
 *
 * This is a fact about deployment topology — is there a proxy in front, and
 * does it OVERWRITE the header rather than append to it — and nothing in this
 * process can determine it. Unset means no: the per-address rate limiter then
 * has no address to count, and only the per-account limiter applies.
 *
 * Setting this when there is no trusted proxy is worse than leaving it off. The
 * header is client-controlled, so every request can name a different address,
 * and each forged value is a fresh counter with a full budget of password
 * guesses. See `A16`/`A17` in tests/integration/http/adapter.test.ts for both
 * halves of that.
 */
function trustsForwardedFor(): boolean {
  return process.env["TRUST_PROXY_HEADERS"] === "true";
}

/**
 * The origin browsers will send. Unset means the Origin check does not run at
 * all — which is the honest behaviour, because a wrong expected origin would
 * refuse every legitimate sign-in while looking like a working control.
 *
 * This must be the exact scheme + host + port the app is served on. It is
 * compared for equality, never by suffix: `https://books.example.com` must not
 * accept `https://books.example.com.evil.net`.
 */
function expectedOrigin(): string | undefined {
  const value = process.env["APP_ORIGIN"];
  return value === undefined || value === "" ? undefined : value;
}

export function adapterConfig(): AdapterConfig {
  return { trustForwardedFor: trustsForwardedFor() };
}

export function authHandlerConfig(): AuthHandlerConfig {
  const origin = expectedOrigin();
  return origin === undefined ? {} : { expectedOrigin: origin };
}

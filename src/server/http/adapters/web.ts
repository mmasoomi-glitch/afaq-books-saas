import { parseCookieHeader } from "../cookies.js";
import type {
  HttpHandler,
  HttpMethod,
  HttpRequest,
  HttpResponse,
} from "../types.js";
import { SECURITY_HEADERS, error } from "../types.js";

/**
 * The adapter, and the ONLY file in `src/server/http/` that knows the WHATWG
 * `Request` and `Response` types exist.
 *
 * Everything else in this directory takes a plain object and returns a plain
 * object. That is what keeps the CSRF comparison, the cookie attributes and the
 * 429 assertable without a server. This file is the seam where that ends and
 * real HTTP begins, so it is deliberately small and does exactly three things:
 * narrow an inbound request, widen an outbound response, and be the one place
 * an unexpected exception is allowed to become a 500.
 *
 * `Request` and `Response` are standard in Node 22, so this file still imports
 * no framework — a Next.js route handler will be one line calling
 * `toRouteHandler`, and the CI check that forbids framework imports under
 * `src/server/http/` keeps applying here.
 */

export interface AdapterConfig {
  /**
   * Whether `x-forwarded-for` may be believed. Default: NO.
   */
  readonly trustForwardedFor?: boolean;
}

export class UnsupportedMethodError extends Error {
  readonly code = "METHOD_NOT_SUPPORTED";

  constructor(method: string) {
    super(`unsupported HTTP method: ${method}`);
    this.name = "UnsupportedMethodError";
  }
}

/**
 * Narrow to the methods we actually serve rather than widening a string with a
 * cast. A cast here would let `TRACE` or an invented verb reach `isMutating`,
 * which answers `false` for anything that is not one of the four it knows — so
 * a request with a made-up method would skip the CSRF check.
 */
function parseMethod(raw: string): HttpMethod | undefined {
  switch (raw.toUpperCase()) {
    case "GET":
      return "GET";
    case "POST":
      return "POST";
    case "PUT":
      return "PUT";
    case "PATCH":
      return "PATCH";
    case "DELETE":
      return "DELETE";
    default:
      return undefined;
  }
}

export async function toHttpRequest(
  request: Request,
  config?: AdapterConfig,
): Promise<HttpRequest> {
  const method = parseMethod(request.method);
  if (method === undefined) {
    throw new UnsupportedMethodError(request.method);
  }

  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of request.headers.entries()) {
    // `Headers` already lowercases names, which is what the rest of the layer
    // assumes when it reads `headers["x-csrf-token"]`.
    headers[name] = value;
  }

  // The body is attacker-controlled, so a malformed one must become a 400 from
  // the handler's own validation — not a 500 from the adapter. `readCredentials`
  // already refuses `undefined`, a string, an array and a wrong-typed field, so
  // handing it `undefined` produces exactly the right answer.
  //
  // Note that an EMPTY body also throws in `json()`. That is the ordinary case
  // for a DELETE, not an attack, which is another reason this cannot be treated
  // as an error worth surfacing.
  let body: unknown;
  if (method !== "GET") {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }

  const ip = clientIp(request, config);

  return {
    method,
    path: new URL(request.url).pathname,
    headers,
    cookies: parseCookieHeader(request.headers.get("cookie") ?? undefined),
    ...(body === undefined ? {} : { body }),
    ...(ip === undefined ? {} : { ip }),
  };
}

/**
 * `x-forwarded-for` is set by the CLIENT unless a proxy overwrites it.
 *
 * This is why the default is not to believe it. The per-address rate limiter
 * keys its counter on whatever this returns, so a client free to choose the
 * value gets a fresh counter on every request — an unlimited budget of password
 * guesses, from one machine, against a limiter that appears to be working.
 * Defaulting to trust would quietly convert a real control into a decorative
 * one, and nothing in the test suite would notice, because in tests the header
 * is whatever the test says it is.
 *
 * Whether the header can be believed is a fact about the deployment topology —
 * is there a proxy in front, does it overwrite or append — and nothing in this
 * process can determine it. So it is configured, and the safe default is to
 * have NO address rather than a forged one. Losing the address is not losing
 * the defence: the per-ACCOUNT limiter still applies, and that is the dimension
 * that stops an attacker grinding one account from many machines.
 */
export function clientIp(
  request: Request,
  config?: AdapterConfig,
): string | undefined {
  if (config?.trustForwardedFor !== true) return undefined;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded === null) return undefined;

  // The FIRST entry, because a trusted proxy APPENDS itself. Taking the last
  // would return our own proxy's address on every request, collapsing every
  // client in the world onto one shared counter — which is worse than having
  // none, because the first few users would exhaust it for everyone.
  const first = forwarded.split(",")[0];
  if (first === undefined) return undefined;

  const trimmed = first.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function toResponse(res: HttpResponse): Response {
  const headers = new Headers(res.headers ?? {});

  // `append`, not `set`. `Set-Cookie` is the one header where repetition is
  // meaningful: `set` would collapse sign-in's two cookies into a single header
  // and the browser would keep only one of them — so a user would arrive
  // holding a session and no CSRF token, and every mutation would 403.
  for (const cookie of res.cookies ?? []) {
    headers.append("set-cookie", cookie);
  }

  return new Response(
    res.body === undefined ? null : JSON.stringify(res.body),
    { status: res.status, headers },
  );
}

export function toRouteHandler(
  handler: HttpHandler,
  config?: AdapterConfig,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      return toResponse(await handler(await toHttpRequest(request, config)));
    } catch (err) {
      if (err instanceof UnsupportedMethodError) {
        return toResponse(
          error(405, err.code, "unsupported method", {
            headers: { ...SECURITY_HEADERS },
          }),
        );
      }

      // The one place a catch-all is correct.
      //
      // `toErrorResponse` in the handlers deliberately RETHROWS what it does
      // not recognise, so a Prisma failure or a null dereference is not
      // flattened into a tidy JSON error that looks handled. Those exceptions
      // have to be caught somewhere, and this is the altitude where the only
      // alternative is an unhandled rejection and a dropped connection.
      //
      // The message is generic on purpose. An exception message routinely
      // carries a query fragment, a file path, a column name or a constraint
      // name, and returning it would hand an attacker a map of the schema.
      console.error("[http] unhandled error", err);
      return toResponse(
        error(500, "INTERNAL", "internal error", {
          headers: { ...SECURITY_HEADERS },
        }),
      );
    }
  };
}

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "../http/cookies";
import type { OrgScope } from "../auth/scope";
import { resolveScopeFromSession } from "../auth/session";
import { AuthError } from "../auth/errors";

/**
 * The ONLY place a page obtains an organization scope.
 *
 * This lives in `src/server/next/` rather than `src/server/http/` because it
 * imports `next/headers` and `next/navigation`, and `src/server/http/` is
 * defined as the layer that imports no framework at all — a CI gate enforces
 * that, and it caught this file in the wrong place before it merged.
 *
 * The distinction is worth keeping rather than relaxing. `src/server/http/`
 * takes a plain object and returns a plain object, which is what makes the
 * CSRF comparison and the cookie attributes assertable without a server.
 * Framework-coupled server code is a different thing and belongs somewhere it
 * can be recognised as such.
 *
 * A page that read the session cookie itself and then trusted the
 * `organizationSlug` from its own URL would have authentication without
 * authorization — it would know who the visitor is and assume they may see the
 * organization they named. `.claude/rules/security-tenancy.md` opens by saying
 * those are not the same thing, and this file is where the difference is
 * enforced for the rendering path, exactly as `guarded.ts` enforces it for the
 * service path.
 *
 * `resolveScopeFromSession` re-resolves membership on every call rather than
 * trusting anything cached in the session, which is what makes a revoked
 * membership take effect on the user's next page load.
 */

/**
 * A scope, or the visitor never sees the page.
 *
 * Both failure modes are deliberate and neither is a 403.
 */
export async function requirePageScope(
  organizationSlug: string,
): Promise<OrgScope> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  // OUTSIDE the try block, and this placement is load-bearing.
  //
  // `redirect()` works by THROWING a control-flow error that Next recognises.
  // If this call sat inside the try below, the catch would swallow the redirect
  // and — since it is not an `AuthError` — rethrow it, or worse, a broader
  // catch would turn it into a 404. "Please sign in" would become "this does
  // not exist", and the bug would look like a routing problem.
  //
  // Not signing in is not an error. It is a visitor who has not signed in yet,
  // and the useful answer is the form.
  if (token === undefined || token === "") {
    redirect("/signin");
  }

  try {
    return await resolveScopeFromSession(token, organizationSlug);
  } catch (error) {
    if (error instanceof AuthError) {
      // 404, never 403, and all four cases collapse to it on purpose.
      //
      // `.claude/rules/security-tenancy.md` requires that another
      // organization's identifier passed to a scoped route returns 404 — "not
      // 200, not 403 with the body leaking the existence". A 403 confirms the
      // organization exists and that you are merely not in it, which turns the
      // URL bar into an enumeration oracle over the customer list.
      //
      // So "no such organization", "not a member", "session expired" and "no
      // such session" are four different facts and must be one indistinguishable
      // answer from outside.
      notFound();
    }

    // Anything else is a bug — a Prisma failure, a null dereference — and
    // turning it into a 404 would hide it behind a page that looks like a
    // legitimate "not found". It goes to Next's error boundary instead.
    throw error;
  }
}

/**
 * The same resolution without the redirect or the 404, for a page that renders
 * differently for a signed-out visitor rather than sending them away.
 *
 * Non-`AuthError` still rethrows, for the same reason: a returned `undefined`
 * here would render the signed-out view after a database failure, which reads
 * as "you are not signed in" and is not true.
 */
export async function optionalPageScope(
  organizationSlug: string,
): Promise<OrgScope | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") return undefined;

  try {
    return await resolveScopeFromSession(token, organizationSlug);
  } catch (error) {
    if (error instanceof AuthError) return undefined;
    throw error;
  }
}

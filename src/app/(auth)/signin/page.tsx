import { headers } from "next/headers";
import type { Metadata } from "next";
import SignInForm from "./SignInForm";

export const metadata: Metadata = {
  title: "Sign in · Naqdengi",
  // A sign-in page has nothing to gain from being indexed, and an indexed one
  // is a published inventory of where the login lives.
  robots: { index: false, follow: false },
};

/**
 * Load-bearing, not tidy.
 *
 * This page embeds a per-visit CSRF token in its HTML. If Next statically
 * rendered or cached it, every visitor would be served the SAME token baked
 * into the markup while the middleware handed each of them a DIFFERENT cookie —
 * so every submission would fail the double-submit comparison. The symptom
 * would be an intermittent 403 that looks like a CSRF bug and is a caching bug.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  // `headers()` is async in Next 15. The value arrives from src/middleware.ts,
  // which committed the matching cookie on this same response.
  const token = (await headers()).get("x-csrf-token");

  if (token === null || token === "") {
    // The honest failure.
    //
    // A server component cannot set a cookie during render, so a token invented
    // here would have no cookie to match and every submission would 403.
    // Rendering the form regardless would produce something that looks like a
    // working sign-in and cannot work — which is precisely what
    // `.claude/rules/no-mocks-no-stubs.md` exists to prevent. Saying the page
    // is not ready is the only truthful option.
    return (
      <main>
        <h1>Sign in</h1>
        <p role="alert">
          This page could not be prepared securely. Reload to try again.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <SignInForm csrfToken={token} />
      <p>
        {/*
          Said up front rather than discovered afterwards: a user who registers,
          signs in, and then sees nothing at all would reasonably conclude the
          product is broken. An account with no membership genuinely cannot
          reach any organization's data — that is the tenancy model working, not
          a failure — so it is better stated here than inferred from an empty
          screen.
        */}
        Creating an account does not grant access to any organization until an
        administrator adds you to one.
      </p>
    </main>
  );
}

import { headers } from "next/headers";
import type { Metadata } from "next";
import RegisterForm from "./RegisterForm";

export const metadata: Metadata = {
  title: "Create an account · Afaq Books",
  robots: { index: false, follow: false },
};

/**
 * Same reason as the sign-in page, and just as load-bearing: this page embeds a
 * per-visit CSRF token. A cached or statically rendered copy would serve one
 * token to every visitor while the middleware handed each of them a different
 * cookie, and every submission would fail the comparison — an intermittent 403
 * that reads as a CSRF bug and is a caching bug.
 */
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const token = (await headers()).get("x-csrf-token");

  if (token === null || token === "") {
    // A server component cannot set a cookie during render, so a token invented
    // here would have no cookie to match it and every submission would 403.
    // Rendering the form regardless would produce something that looks like a
    // working sign-up and cannot work.
    return (
      <main>
        <h1>Create an account</h1>
        <p role="alert">
          This page could not be prepared securely. Reload to try again.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Create an account</h1>
      <RegisterForm csrfToken={token} />
      <p>
        {/*
          Stated before the form rather than after the surprise. Registering
          creates an account with no organization membership, which is the
          tenancy model working rather than a failure — but a user who is not
          told that will read the resulting empty screen as a broken product.
        */}
        An account on its own gives access to nothing. An administrator must add
        you to an organization before you can see or post anything in it.
      </p>
      <p>
        Already have an account? <a href="/signin">Sign in</a>.
      </p>
    </main>
  );
}

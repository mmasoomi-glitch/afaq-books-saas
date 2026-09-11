import type { NextConfig } from "next";

/**
 * Security headers for the PAGE responses.
 *
 * The JSON endpoints already set their own, per response, in
 * `src/server/http/types.ts` — every handler returns them whether it answers
 * 200, 401 or 500, so they do not depend on this file being right. What is here
 * covers the HTML Next serves, which that layer never sees.
 *
 * The Content-Security-Policy is deliberately NOT the API one. The API sends
 * `default-src 'none'`, which is correct for a response that is JSON and can
 * never legitimately load a script. A page needs to load its own scripts and
 * styles, so reusing the API policy would produce a blank page, and the usual
 * fix — loosening the shared constant — would quietly weaken every API response
 * at the same time. Two policies, on purpose.
 *
 * `'unsafe-inline'` for styles is Next's requirement: it inlines critical CSS
 * during hydration. It is not needed for scripts and is not granted to them.
 */
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on a type error or a lint error rather than
  // shipping past it. Both of these default to false already; they are written
  // out because the option to ignore them exists, and a future "just get the
  // build green" change should have to delete a line that says what it does.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Next reports its own version in a response header by default. It tells an
  // attacker which advisories to try and tells a user nothing.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "DENY" },
          {
            key: "referrer-policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "strict-transport-security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "content-security-policy", value: PAGE_CSP },
        ],
      },
    ];
  },
};

export default nextConfig;

import { cache } from "react";
import type { OrgScope } from "../auth/scope";
import { requirePageScope } from "./page-scope";

/**
 * `requirePageScope`, resolved once per render pass instead of once per caller.
 *
 * The org layout and the page beneath it both need the scope, and each call
 * reads the session row and the membership row. Without this, every page under
 * `/o/[orgSlug]` does that work twice.
 *
 * **What this does not do.** React's `cache()` memoises for the duration of one
 * server render — not across requests, not across users, not across two tabs.
 * That matters here more than performance does: `page-scope.ts` re-resolves
 * membership on every call specifically so a revoked membership takes effect on
 * the user's next page load, and a cache with any lifetime beyond a single
 * render would quietly undo that.
 *
 * A `redirect()` or `notFound()` thrown by the first call is memoised as a
 * rejection and rethrown to the second, which is the same outcome the second
 * call would have reached on its own.
 */
export const cachedPageScope: (organizationSlug: string) => Promise<OrgScope> =
  cache(requirePageScope);

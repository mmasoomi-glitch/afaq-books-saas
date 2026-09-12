import type { MembershipRole } from "@prisma/client";
import type { HttpHandler, HttpRequest, HttpResponse } from "../types";
import { error, json, noContent } from "../types";
import { SESSION_COOKIE } from "../cookies";
import { verifyCsrf } from "../csrf";
import { readString } from "./scoped";
import type { ScopedHandler } from "./scoped";
import { toErrorResponse } from "./auth";
import { resolveSession } from "../../auth/session";
import { enforce } from "../../auth/rate-limit";
import { AuthError } from "../../auth/errors";
import {
  changeRole,
  createOrganization,
  grantMembership,
  removeMember,
  transferOwnership,
} from "../../auth/membership";

/**
 * Organization and membership endpoints.
 *
 * Every mutation here is CSRF-checked and, apart from creation, runs behind
 * `withOrgScope` — so by the time one of these functions executes, the caller's
 * membership in the organization named in the URL has been re-resolved from the
 * database on this request.
 */

const ROLES: readonly MembershipRole[] = [
  "VIEWER",
  "BOOKKEEPER",
  "APPROVER",
  "ACCOUNTANT",
  "ADMIN",
  "OWNER",
];

/**
 * A role from a request body, narrowed against the real enum.
 *
 * Passing the string straight through would let a caller name a role that does
 * not exist. Prisma would reject it, but the failure would surface as a
 * database error and a 500 rather than as the 400 it is — and an attacker
 * learns more from a 500 than from a refusal.
 *
 * `"OWNER"` is accepted HERE and refused downstream by `assertGrantable`, which
 * is deliberate: the validation layer's job is to say whether the input is a
 * role, and the authorization layer's job is to say whether this caller may
 * grant it. Collapsing the two would put an authorization rule in a parser.
 */
function readRole(body: unknown): MembershipRole | undefined {
  const raw = readString(body, "role");
  if (raw === undefined) return undefined;
  return ROLES.find((role) => role === raw);
}

function badBody(message: string): HttpResponse {
  return error(400, "INVALID_BODY", message);
}

/** Wraps a scoped handler so every one of them answers errors identically. */
function guarded(handler: ScopedHandler): ScopedHandler {
  return async (req, scope) => {
    try {
      verifyCsrf(req);
      return await handler(req, scope);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/**
 * `POST /api/organizations` — create one, becoming its OWNER.
 *
 * Not scoped by an organization, obviously, so it resolves the session
 * directly. Any authenticated user may create one; there is no plan or quota
 * model yet, and when there is, it belongs here.
 */
export function createOrganizationHandler(): HttpHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    if (req.method !== "POST") {
      return error(405, "METHOD_NOT_ALLOWED", "POST required", {
        headers: { allow: "POST" },
      });
    }

    try {
      verifyCsrf(req);

      const token = req.cookies[SESSION_COOKIE];
      if (token === undefined || token === "") {
        return error(401, "AUTH_SESSION_NOT_FOUND", "not authenticated");
      }

      // 401 rather than the 404 the scoped routes use. There is no
      // organization being named here, so there is nothing whose existence a
      // 401 could confirm — the enumeration argument simply does not apply.
      const { userId } = await resolveSession(token);

      // Limited explicitly, because this route does NOT pass through
      // `withOrgScope` — it is what creates the organization a scope would
      // resolve against. It is also the only write a brand-new account with no
      // memberships can make, which makes it the one worth not leaving open.
      //
      // Same "write" budget as every other mutation, deliberately: a user who
      // has spent their budget posting entries should not find a second,
      // separate allowance for creating tenants.
      //
      // A `RateLimitedError` is already mapped to 429 with `Retry-After` by
      // `toErrorResponse` below, so this needs no special handling — it only
      // needs to be here at all.
      await enforce("write", req.ip, userId);

      const slug = readString(req.body, "slug");
      const name = readString(req.body, "name");
      if (slug === undefined || name === undefined) {
        return badBody("slug and name are required");
      }

      const created = await createOrganization(userId, { slug, name });
      return json(201, created);
    } catch (err) {
      // A database CHECK violation on the slug format or a reserved word is
      // not an AuthError and would otherwise become a 500. It is a 400: the
      // caller sent something invalid and can fix it.
      if (!(err instanceof AuthError) && isCheckViolation(err)) {
        return badBody(
          "slug must be 3-40 lowercase letters, digits and single hyphens, and must not be a reserved word",
        );
      }
      return toErrorResponse(err);
    }
  };
}

/** Prisma surfaces a Postgres CHECK failure as P2010 or an unknown request error. */
function isCheckViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const message = "message" in err ? String(err.message) : "";
  return (
    message.includes("organizations_slug_format") ||
    message.includes("organizations_slug_not_reserved")
  );
}

/** `POST /api/[orgSlug]/members` — grant a membership by email. */
export function grantMemberHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const email = readString(req.body, "email");
    const role = readRole(req.body);
    if (email === undefined || role === undefined) {
      return badBody("email and a valid role are required");
    }

    const { userId } = await grantMembership(scope, email, role);
    return json(201, { userId, role });
  });
}

/** `PATCH /api/[orgSlug]/members/[userId]` — change a role. */
export function changeRoleHandler(targetUserId: string): ScopedHandler {
  return guarded(async (req, scope) => {
    const role = readRole(req.body);
    if (role === undefined) return badBody("a valid role is required");

    await changeRole(scope, targetUserId, role);
    return noContent();
  });
}

/** `DELETE /api/[orgSlug]/members/[userId]` — remove a member. */
export function removeMemberHandler(targetUserId: string): ScopedHandler {
  return guarded(async (_req, scope) => {
    await removeMember(scope, targetUserId);
    return noContent();
  });
}

/** `POST /api/[orgSlug]/ownership` — hand the organization over. */
export function transferOwnershipHandler(): ScopedHandler {
  return guarded(async (req, scope) => {
    const userId = readString(req.body, "userId");
    if (userId === undefined) return badBody("userId is required");

    await transferOwnership(scope, userId);
    return noContent();
  });
}

// src/lib/authz.ts
//
// Central place for the one rule the user asked for: only the super admin
// (theeventsmithng@gmail.com, tier SUPER_ADMIN, isProtected = true) can add
// team members or authorise client emails. Every other admin action keeps
// using the existing tier checks (SENIOR vs JUNIOR) — this file only adds
// the layer above that.

import { db } from "./db";
import type { AdminUser } from "@prisma/client";

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves a session's admin identity and throws unless it's the super
 * admin. Use this to guard the two actions that are super-admin-only:
 * creating/deactivating AdminUser rows, and creating AuthorisedClientEmail
 * rows. Everything else (viewing events, budget, etc.) keeps using the
 * ordinary SENIOR/JUNIOR tier checks elsewhere in the codebase.
 */
export function requireSuperAdmin(session: { type: string; adminUser?: AdminUser } | null) {
  if (!session || session.type !== "admin" || !session.adminUser) {
    throw new AuthzError("Admin session required.", 401);
  }
  if (session.adminUser.tier !== "SUPER_ADMIN") {
    throw new AuthzError("Only the super admin can do this.", 403);
  }
  return session.adminUser;
}

/**
 * Guards against ever weakening the permanent super admin account —
 * deactivating it, demoting its tier, or deleting it. Call this before any
 * update/delete against an AdminUser row, regardless of who is asking.
 */
export function assertNotProtected(target: Pick<AdminUser, "isProtected" | "email">) {
  if (target.isProtected) {
    throw new AuthzError(
      `${target.email} is the permanent super admin and can't be deactivated, demoted, or removed.`,
      409,
    );
  }
}

/**
 * True if this email is the seeded super admin address. Useful in seed
 * scripts / one-off checks where a full session object doesn't exist.
 */
export function isSuperAdminEmail(email: string) {
  return email.trim().toLowerCase() === "theeventsmithng@gmail.com";
}

/** Convenience lookup used by the team/client-email routes below. */
export async function getAdminUserByEmail(email: string) {
  return db.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
}

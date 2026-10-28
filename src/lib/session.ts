// src/lib/session.ts
//
// Session tokens are opaque random strings stored server-side (not signed
// JWTs) so a session can be revoked instantly by deleting the row — useful
// if a client's authorised email is ever removed from an event.

import crypto from "crypto";
import { db } from "./db";

const ADMIN_SESSION_DAYS = 3;
const CLIENT_SESSION_DAYS = 7;

export async function createSession(target: { adminUserId?: string; clientEmailId?: string }) {
  const token = crypto.randomBytes(32).toString("hex");
  const days = target.adminUserId ? ADMIN_SESSION_DAYS : CLIENT_SESSION_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await db.session.create({
    data: {
      token,
      expiresAt,
      adminUserId: target.adminUserId,
      clientEmailId: target.clientEmailId,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolves a session token to either an admin identity or a client identity
 * that is scoped to exactly one event (via AuthorisedClientEmail.eventId).
 * Every event-scoped API route should call this and then check
 * clientEmail.eventId === requestedEventId before returning anything.
 */
export async function resolveSession(token: string) {
  const session = await db.session.findUnique({
    where: { token },
    include: { adminUser: true, clientEmail: { include: { event: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;

  if (session.adminUser) {
    return { type: "admin" as const, adminUser: session.adminUser };
  }
  if (session.clientEmail) {
    return {
      type: "client" as const,
      clientEmail: session.clientEmail,
      scopedEventId: session.clientEmail.eventId,
    };
  }
  return null;
}

export async function destroySession(token: string) {
  await db.session.delete({ where: { token } }).catch(() => {
    // Already gone — fine, sign-out should be idempotent.
  });
}

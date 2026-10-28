// src/lib/otp.ts
//
// Passwordless email OTP — Section 8 of the blueprint, implemented.
// - Codes are never stored in plaintext, only a salted hash.
// - Codes expire (default 10 minutes) and are single-use.
// - Verification attempts are rate-limited per code and the request endpoint
//   should additionally rate-limit per email/IP (see request-code route).

import crypto from "crypto";
import { db } from "./db";

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;

export function generateNumericCode(length: number = CODE_LENGTH): string {
  // crypto.randomInt is cryptographically strong and avoids modulo bias.
  let code = "";
  for (let i = 0; i < length; i++) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

function hashCode(code: string): string {
  // HMAC with a server-side secret pepper, so a leaked DB row alone can't be
  // brute-forced offline as fast as a bare hash would allow.
  const pepper = process.env.OTP_HASH_SECRET;
  if (!pepper) throw new Error("OTP_HASH_SECRET is not set");
  return crypto.createHmac("sha256", pepper).update(code).digest("hex");
}

/**
 * Issues a new OTP for either an AdminUser or an AuthorisedClientEmail.
 * Returns the plaintext code — the caller is responsible for emailing it
 * and must never log or persist it in plaintext anywhere.
 *
 * Pass `presetCode` when the same code needs to be valid across several
 * target rows at once (e.g. one email authorised on multiple events) —
 * see request-code route.
 */
export async function issueOtp(
  target: { adminUserId?: string; clientEmailId?: string },
  presetCode?: string
) {
  const code = presetCode ?? generateNumericCode(CODE_LENGTH);
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await db.otpCode.create({
    data: {
      codeHash,
      expiresAt,
      adminUserId: target.adminUserId,
      clientEmailId: target.clientEmailId,
    },
  });

  return { code, expiresAt };
}

export type VerifyResult =
  | { ok: true; adminUserId?: string; clientEmailId?: string }
  | { ok: false; reason: "not_found" | "expired" | "used" | "too_many_attempts" | "incorrect" };

/**
 * Verifies a submitted code against the most recent unused OTP for the
 * given target. Single-use: marks the row used on success so it can never
 * be replayed.
 */
export async function verifyOtp(
  target: { adminUserId?: string; clientEmailId?: string },
  submittedCode: string
): Promise<VerifyResult> {
  const otp = await db.otpCode.findFirst({
    where: {
      adminUserId: target.adminUserId,
      clientEmailId: target.clientEmailId,
      used: false,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return { ok: false, reason: "not_found" };
  if (otp.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  const submittedHash = hashCode(submittedCode);

  if (submittedHash !== otp.codeHash) {
    await db.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "incorrect" };
  }

  await db.otpCode.update({
    where: { id: otp.id },
    data: { used: true },
  });

  return { ok: true, adminUserId: target.adminUserId, clientEmailId: target.clientEmailId };
}

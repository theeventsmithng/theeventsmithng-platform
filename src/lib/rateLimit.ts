// src/lib/rateLimit.ts
//
// Minimal sliding-window rate limiter using the OtpCode table itself as the
// source of truth (no extra infrastructure needed for launch). Swap for
// Redis/Upstash later if request volume ever justifies it.

import { db } from "./db";

export async function checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000);

  // key is "otp-request:<email>" — count OTP rows created for that email
  // (admin or client) in the window.
  const email = key.replace("otp-request:", "");

  const [adminCount, clientCount] = await Promise.all([
    db.otpCode.count({
      where: { createdAt: { gte: since }, adminUser: { email } },
    }),
    db.otpCode.count({
      where: { createdAt: { gte: since }, clientEmail: { email } },
    }),
  ]);

  return adminCount + clientCount < maxRequests;
}

// POST /api/auth/request-code
// Body: { email: string }
//
// Deliberately returns the same generic response whether or not the email
// is authorised, so the endpoint can never be used to enumerate which
// emails have platform access (Section 8's "never confirm/deny" rule).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueOtp, generateNumericCode } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rateLimit";

const GENERIC_RESPONSE = {
  message: "If this email is authorised, a code has been sent.",
};

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const normalisedEmail = email.trim().toLowerCase();

  // Rate limit code *requests* per email — separate from the per-code
  // verify-attempt limit in otp.ts. e.g. max 5 requests/hour.
  const allowed = await checkRateLimit(`otp-request:${normalisedEmail}`, 5, 60 * 60);
  if (!allowed) {
    // Still return the generic response — don't leak that rate limiting fired.
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const adminUser = await db.adminUser.findUnique({ where: { email: normalisedEmail } });

  if (adminUser?.isActive) {
    const { code } = await issueOtp({ adminUserId: adminUser.id });
    await sendOtpEmail(normalisedEmail, code);
    return NextResponse.json(GENERIC_RESPONSE);
  }

  // Client emails are scoped per-event; one email could theoretically be
  // authorised on more than one event (e.g. a repeat client). We send one
  // OTP row per matching AuthorisedClientEmail and let verify-code figure
  // out which event(s) it unlocks.
  const clientEmails = await db.authorisedClientEmail.findMany({
    where: { email: normalisedEmail },
  });

  if (clientEmails.length > 0) {
    // Generate the code once, then issue an identically-valued (but
    // independently hashed) OTP row per authorised event, so a single
    // emailed code unlocks whichever event(s) this address is tied to.
    const sharedCode = generateNumericCode();
    await Promise.all(clientEmails.map((ce) => issueOtp({ clientEmailId: ce.id }, sharedCode)));
    await sendOtpEmail(normalisedEmail, sharedCode);
  }

  return NextResponse.json(GENERIC_RESPONSE);
}

// POST /api/auth/verify-code
// Body: { email: string, code: string }
//
// On success, sets an HTTP-only, Secure, SameSite=Lax session cookie and
// tells the client whether to route to /admin or /client/[eventId]. If the
// email is authorised on multiple events, returns the list so the frontend
// can offer a picker.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code are required." }, { status: 400 });
  }

  const normalisedEmail = String(email).trim().toLowerCase();

  const adminUser = await db.adminUser.findUnique({ where: { email: normalisedEmail } });

  if (adminUser) {
    const result = await verifyOtp({ adminUserId: adminUser.id }, code);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 401 });

    const { token, expiresAt } = await createSession({ adminUserId: adminUser.id });
    const res = NextResponse.json({ destination: "admin" });
    setSessionCookie(res, token, expiresAt);
    return res;
  }

  const clientEmails = await db.authorisedClientEmail.findMany({
    where: { email: normalisedEmail },
    include: { event: true },
  });

  for (const ce of clientEmails) {
    const result = await verifyOtp({ clientEmailId: ce.id }, code);
    if (result.ok) {
      const { token, expiresAt } = await createSession({ clientEmailId: ce.id });
      const res = NextResponse.json({
        destination: "client",
        events: clientEmails.map((c) => ({ id: c.eventId, names: c.event.names })),
      });
      setSessionCookie(res, token, expiresAt);
      return res;
    }
  }

  return NextResponse.json({ error: "incorrect_or_expired" }, { status: 401 });
}

function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set("tes_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

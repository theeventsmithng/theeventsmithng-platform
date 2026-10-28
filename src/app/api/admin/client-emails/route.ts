// GET  /api/admin/client-emails?eventId=...   — list authorised emails for an event
// POST /api/admin/client-emails                — authorise a client email for an event
// Body (POST): { email: string, eventId: string }
//
// Only the super admin may authorise a client email. Once added, that
// email can request an OTP at /api/auth/request-code and land on that
// event's client dashboard once verified — the existing flow in
// verify-code/route.ts picks this record up automatically; no change
// needed there.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveSession } from "@/lib/session";
import { requireSuperAdmin, AuthzError } from "@/lib/authz";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    requireSuperAdmin(session);

    const eventId = req.nextUrl.searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId query param is required." }, { status: 400 });

    const authorised = await db.authorisedClientEmail.findMany({
      where: { eventId },
      orderBy: { addedAt: "asc" },
    });
    return NextResponse.json(authorised);
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    const superAdmin = requireSuperAdmin(session);

    const { email, eventId } = await req.json();
    if (!email || typeof email !== "string" || !eventId) {
      return NextResponse.json({ error: "email and eventId are required." }, { status: 400 });
    }

    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    const normalisedEmail = email.trim().toLowerCase();

    const existing = await db.authorisedClientEmail.findUnique({
      where: { email_eventId: { email: normalisedEmail, eventId } },
    });
    if (existing) {
      return NextResponse.json({ error: "This email is already authorised on this event." }, { status: 409 });
    }

    const created = await db.authorisedClientEmail.create({
      data: { email: normalisedEmail, eventId, addedByAdminId: superAdmin.id },
    });

    await db.activityLogEntry.create({
      data: {
        eventId,
        action: "Client email authorised",
        metadata: { email: normalisedEmail, authorisedBy: superAdmin.email },
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// DELETE /api/admin/client-emails?id=... — revoke a client's access.
export async function DELETE(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    requireSuperAdmin(session);

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id query param is required." }, { status: 400 });

    await db.authorisedClientEmail.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

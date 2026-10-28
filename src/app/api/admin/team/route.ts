// GET  /api/admin/team       — list all team (AdminUser) accounts
// POST /api/admin/team       — add a new team member
// Body (POST): { email: string, name: string, tier: "SENIOR" | "JUNIOR" }
//
// Only the super admin (theeventsmithng@gmail.com) may add team members.
// This is the gate the user asked for: "that one would always have access,
// and then with that one I can then add team and add clients". A new team
// member gets no password — the next time they request a code at
// /api/auth/request-code, they'll receive an OTP and land on the admin
// side once verified, per the existing OTP flow.
//
// Note on "tier": a new team member is always created as SENIOR or JUNIOR.
// SUPER_ADMIN is never an assignable tier here — there is exactly one
// super admin, seeded once (prisma/seed.ts), never created through this
// route.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveSession } from "@/lib/session";
import { requireSuperAdmin, assertNotProtected, AuthzError } from "@/lib/authz";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    requireSuperAdmin(session);

    const team = await db.adminUser.findMany({
      orderBy: [{ isProtected: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        tier: true,
        isActive: true,
        isProtected: true,
        createdAt: true,
      },
    });
    return NextResponse.json(team);
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    const superAdmin = requireSuperAdmin(session);

    const { email, name, tier } = await req.json();

    if (!email || typeof email !== "string" || !name || typeof name !== "string") {
      return NextResponse.json({ error: "email and name are required." }, { status: 400 });
    }
    if (tier !== "SENIOR" && tier !== "JUNIOR") {
      return NextResponse.json(
        { error: "tier must be SENIOR or JUNIOR — SUPER_ADMIN cannot be assigned here." },
        { status: 400 },
      );
    }

    const normalisedEmail = email.trim().toLowerCase();

    const existing = await db.adminUser.findUnique({ where: { email: normalisedEmail } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const created = await db.adminUser.create({
      data: {
        email: normalisedEmail,
        name,
        tier,
        isActive: true,
        addedByAdminId: superAdmin.id,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// PATCH /api/admin/team — deactivate/reactivate or change a team member's
// tier. Still super-admin-only, and still can't touch the protected row.
// Body: { adminUserId: string, isActive?: boolean, tier?: "SENIOR"|"JUNIOR" }
export async function PATCH(req: NextRequest) {
  try {
    const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
    requireSuperAdmin(session);

    const { adminUserId, isActive, tier } = await req.json();
    if (!adminUserId) {
      return NextResponse.json({ error: "adminUserId is required." }, { status: 400 });
    }
    if (tier === "SUPER_ADMIN") {
      return NextResponse.json({ error: "SUPER_ADMIN cannot be assigned through this route." }, { status: 400 });
    }

    const target = await db.adminUser.findUnique({ where: { id: adminUserId } });
    if (!target) return NextResponse.json({ error: "Team member not found." }, { status: 404 });

    assertNotProtected(target);

    const updated = await db.adminUser.update({
      where: { id: adminUserId },
      data: {
        ...(typeof isActive === "boolean" ? { isActive } : {}),
        ...(tier === "SENIOR" || tier === "JUNIOR" ? { tier } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof AuthzError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

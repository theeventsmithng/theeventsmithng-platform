// GET /api/admin/bootstrap?secret=...
//
// One-time production bootstrap: there is no way to run `prisma db seed`
// against the live Vercel/Supabase database directly (no shell access to
// production, and the seed script needs a live DB connection a local dev
// environment usually can't reach either). This route exists purely so the
// permanent super admin account + Wedding template can be created in
// production by visiting a URL once, instead of needing database CLI access.
//
// Protected by a secret (BOOTSTRAP_SECRET env var) so nobody else can hit
// it. Safe to call more than once — seedDatabase() is idempotent (see
// src/lib/seedDatabase.ts for exactly what "idempotent" covers).
//
// Recommended: once you've confirmed it worked, remove BOOTSTRAP_SECRET
// from Vercel's environment variables (or delete this route) so it can't be
// called again by anyone who guesses the URL.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seedDatabase } from "@/lib/seedDatabase";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expected = process.env.BOOTSTRAP_SECRET;

  if (!expected) {
    return NextResponse.json({ error: "BOOTSTRAP_SECRET is not configured." }, { status: 500 });
  }
  if (!secret || secret !== expected) {
    return NextResponse.json({ error: "Invalid or missing secret." }, { status: 401 });
  }

  try {
    await seedDatabase(db);
    return NextResponse.json({ ok: true, message: "Database bootstrapped: super admin + Wedding template are in place." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

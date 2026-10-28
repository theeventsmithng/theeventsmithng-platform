// POST /api/documents
// Body: { eventId, vendorId?, category, name, isVisibleToClient?, storageKey,
//         revisionNote? }
//
// Step 2 of 2. Called after the browser's direct-to-storage upload
// succeeds. Creates the Document plus its first DocumentVersion, marked
// current by default. For the moodboard specifically, this is the only
// table involved — no separate moodboard database, per the blueprint.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { eventId, vendorId, category, name, isVisibleToClient, storageKey, revisionNote } = body;

  if (!eventId || !category || !name || !storageKey) {
    return NextResponse.json(
      { error: "eventId, category, name and storageKey are required." },
      { status: 400 }
    );
  }

  const document = await db.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        eventId,
        vendorId: vendorId ?? null,
        category,
        name,
        isVisibleToClient: !!isVisibleToClient,
      },
    });

    await tx.documentVersion.create({
      data: {
        documentId: created.id,
        fileUrl: storageKey,
        versionLabel: "Version 1",
        revisionNote: revisionNote ?? null,
        isCurrent: true,
        isApproved: false,
      },
    });

    await tx.activityLogEntry.create({
      data: { eventId, action: `Document uploaded — ${name}`, metadata: { documentId: created.id } },
    });

    return created;
  });

  return NextResponse.json(document, { status: 201 });
}

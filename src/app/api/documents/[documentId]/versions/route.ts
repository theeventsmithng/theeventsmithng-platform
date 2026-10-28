// POST /api/documents/[documentId]/versions
// Body: { storageKey, revisionNote?, markApproved? }
//
// This is what "Replace the moodboard when revisions are made" (Section on
// Moodboard PDF in the blueprint) actually is: a new DocumentVersion on the
// same Document, with the previous version's isCurrent flipped off — never
// overwritten, never deleted, so old revisions stay available.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: { documentId: string } }) {
  const { documentId } = params;
  const { storageKey, revisionNote, markApproved } = await req.json();

  if (!storageKey) {
    return NextResponse.json({ error: "storageKey is required." }, { status: 400 });
  }

  const version = await db.$transaction(async (tx) => {
    const document = await tx.document.findUnique({
      where: { id: documentId },
      include: { versions: true },
    });
    if (!document) throw new Error("Document not found");

    await tx.documentVersion.updateMany({
      where: { documentId },
      data: { isCurrent: false },
    });

    const nextVersionNumber = document.versions.length + 1;

    const created = await tx.documentVersion.create({
      data: {
        documentId,
        fileUrl: storageKey,
        versionLabel: `Version ${nextVersionNumber}`,
        revisionNote: revisionNote ?? null,
        isCurrent: true,
        isApproved: !!markApproved,
      },
    });

    await tx.activityLogEntry.create({
      data: {
        eventId: document.eventId,
        action: `Document replaced — ${document.name} → ${created.versionLabel}`,
        metadata: { documentId, versionId: created.id },
      },
    });

    return created;
  });

  return NextResponse.json(version, { status: 201 });
}

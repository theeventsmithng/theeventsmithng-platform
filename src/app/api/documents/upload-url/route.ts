// POST /api/documents/upload-url
// Body: { eventId, fileName, contentType }
//
// Step 1 of 2 for uploading a document. The browser calls this first, gets
// a presigned URL, PUTs the file straight to storage, then calls
// POST /api/documents (below) or /versions (for a revision) to record it.

import { NextRequest, NextResponse } from "next/server";
import { createUploadUrl } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const { eventId, fileName, contentType } = await req.json();

  if (!eventId || !fileName || !contentType) {
    return NextResponse.json({ error: "eventId, fileName and contentType are required." }, { status: 400 });
  }

  const { uploadUrl, key } = await createUploadUrl(eventId, fileName, contentType);
  return NextResponse.json({ uploadUrl, key });
}

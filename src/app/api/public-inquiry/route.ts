// POST /api/public-inquiry
//
// Receives submissions from the public marketing website
// (theeventsmithng.com, hosted separately on Truehost) and emails them to
// the business via Resend. This is a plain notification endpoint — it does
// not write to the database or the admin platform's own data model, it
// just makes sure a human sees every inquiry and booking request.
//
// Called cross-origin from theeventsmithng.com, so CORS is handled
// explicitly below (OPTIONS preflight + Access-Control-Allow-Origin on the
// real response).

import { NextRequest, NextResponse } from "next/server";

const NOTIFY_TO = ["theeventsmithng@gmail.com", "crafter@theeventsmithng.com"];

// Restrict which origins may call this. Add others here if the site is
// ever served from another host (e.g. a staging domain).
const ALLOWED_ORIGINS = new Set([
  "https://theeventsmithng.com",
  "https://www.theeventsmithng.com",
]);

function corsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://theeventsmithng.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req.headers.get("origin"));

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers });
  }

  const kind = body.kind === "booking" ? "booking" : "inquiry";

  // Basic validation — keep it simple, this is a notification endpoint,
  // not a data store, so we don't need a full schema.
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!name || !email) {
    return NextResponse.json({ ok: false, error: "Name and email are required." }, { status: 400, headers });
  }

  let subject: string;
  let html: string;

  if (kind === "booking") {
    const date = typeof body.date === "string" ? body.date : "";
    const time = typeof body.time === "string" ? body.time : "";
    subject = `New consultation booking request — ${name}`;
    html = `
      <h2>New consultation booking request</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Requested date:</strong> ${escapeHtml(date)}</p>
      <p><strong>Requested time:</strong> ${escapeHtml(time)}</p>
      <p style="color:#777; font-size:13px;">Submitted from theeventsmithng.com. This is a request, not a confirmed slot — reply to the client directly to confirm.</p>
    `;
  } else {
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    subject = `New website inquiry — ${name}`;
    html = `
      <h2>New website inquiry</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Event type:</strong> ${escapeHtml(eventType || "Not specified")}</p>
      <p><strong>Message:</strong><br>${escapeHtml(message || "(none)").replace(/\n/g, "<br>")}</p>
      <p style="color:#777; font-size:13px;">Submitted from theeventsmithng.com.</p>
    `;
  }

  const apiKey = process.env.RESEND_API_KEY;
  // Deliberately separate from OTP_FROM_EMAIL (used only for sign-in codes)
  // so website notifications and login emails can have different senders.
  const from = process.env.INQUIRY_FROM_EMAIL;
  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, error: "Email service is not configured." }, { status: 500, headers });
  }

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: NOTIFY_TO,
        reply_to: email,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend failed:", resendRes.status, errText);
      return NextResponse.json({ ok: false, error: "Failed to send notification email." }, { status: 502, headers });
    }

    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("public-inquiry error:", message);
    return NextResponse.json({ ok: false, error: "Unexpected server error." }, { status: 500, headers });
  }
}

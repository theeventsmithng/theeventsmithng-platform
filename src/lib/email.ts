// src/lib/email.ts
//
// OTP delivery via Resend — chosen in Section 8/9 of the blueprint for its
// permanent free tier (3,000 emails/month, 100/day), which comfortably
// covers OTP volume for a single event-planning business. Swap the
// implementation here if you outgrow it later; nothing else in the app
// needs to change.

const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendOtpEmail(to: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.OTP_FROM_EMAIL || "The EventSmith NG <login@theeventsmithng.com>",
      to,
      subject: "Your sign-in code",
      html: `
        <div style="font-family: sans-serif; color: #2A2018;">
          <p>Your one-time code is:</p>
          <p style="font-size: 28px; font-weight: 600; letter-spacing: 4px;">${code}</p>
          <p style="color: #8C7C68; font-size: 13px;">
            This code expires in 10 minutes and can only be used once.
            Never share this code with anyone — The EventSmith NG will never ask you for it.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed (${res.status}): ${body}`);
  }
}

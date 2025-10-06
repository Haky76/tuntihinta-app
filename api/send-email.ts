import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed", method: req.method });
  }

  try {
    const { to, subject, html } = req.body;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM, // esim. "Tuntihintasi <no-reply@tuntihintasi.fi>"
        to,
        subject,
        html,
      }),
    });

    const data = await resendResponse.json();

    if (!resendResponse.ok) {
      return res.status(resendResponse.status).json({ ok: false, error: data });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}



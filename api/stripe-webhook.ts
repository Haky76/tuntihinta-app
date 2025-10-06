import { NextApiRequest, NextApiResponse } from "next";
import { Resend } from "resend";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-08-27.basil" });
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed", method: req.method });
  }

  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // jos käytät raw bodya, käytä Bufferia
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("❌ Stripe signature verification failed:", err?.message);
    return res.status(400).json({ ok: false, error: "invalid_signature", message: err?.message });
  }

  console.log("✅ Stripe event:", event.type, event.id);

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // Asiakkaan email (Stripe palauttaa sen eri paikoista tilanteesta riippuen)
      const to =
        session.customer_details?.email ||
        (typeof session.customer === "string"
          ? (await stripe.customers.retrieve(session.customer))?.email
          : session.customer?.email);

      console.log("📧 send email to:", to);

      // turva: jos ei emailia, älä jatka
      if (!to) {
        console.error("❌ No customer email in session");
        return res.status(422).json({ ok: false, error: "missing_email" });
      }

      const from = `Tuntihintasi <no-reply@tuntihintasi.fi>`;
      const subject = "Kuitti ja kirjautumistunnus";
      const html = `<p>Kiitos tilauksesta! Tässä kuitti ja kirjautumistunnus…</p>`;

      const sent = await resend.emails.send({ from, to, subject, html });

      console.log("📨 Resend response:", sent);

      // jos Resend palauttaa virheen, lähetetään 500 ettei se peity 200-koodin alle
      if (sent?.error) {
        console.error("❌ Resend error:", sent.error);
        return res.status(500).json({ ok: false, error: "resend_failed", detail: sent.error });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("🔥 Handler error:", err?.message ?? err);
    return res.status(500).json({ ok: false, error: "handler_error", message: err?.message ?? String(err) });
  }
}

// api/stripe-webhooks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

/**
 * VAATIMUKSET ympäristömuuttujiin (Production + Preview):
 *  - STRIPE_SECRET_KEY        (sk_test_... / sk_live_...)
 *  - STRIPE_WEBHOOK_SECRET    (whsec_...)
 *  - RESEND_API_KEY           (re_...)
 *  - EMAIL_FROM               (esim. "Tuntihintasi <no-reply@tuntihintasi.fi>")
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Stripe webhookit hyväksyvät vain POSTin
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, error: "missing STRIPE_WEBHOOK_SECRET" });
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return res.status(500).json({ ok: false, error: "missing RESEND envs" });
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    return res.status(400).json({ ok: false, error: "missing stripe-signature header" });
  }

  // Vercel Node -funktiossa body on yleensä jo parsittu → muodosta raakateksti
  const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err?.message ?? err);
    return res.status(400).json({ ok: false, error: "invalid_signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Haetaan täydemmät tiedot: maksutapahtuma ja asiakkaan sähköposti
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ["payment_intent.charges.data", "customer_details"],
        });

        const email =
          fullSession.customer_details?.email ||
          (typeof fullSession.customer === "string" ? undefined : fullSession.customer?.email);

        const amountCents = fullSession.amount_total ?? 0;
        const amount = (amountCents / 100).toFixed(2);
        const currency = (fullSession.currency || "eur").toUpperCase();
        const paidAt = new Date((fullSession.created ?? Math.floor(Date.now() / 1000)) * 1000);

        // Yritetään poimia kuittilinkki (Stripe Charge -> receipt_url)
        const pi = fullSession.payment_intent as Stripe.PaymentIntent | null;
        const charge = pi?.charges?.data?.[0];
        const receiptUrl = charge?.receipt_url;

        // Jos sähköpostia ei löydy, ei voida lähettää kuittia
        if (!email) {
          console.warn("⚠️  Ei asiakkaan sähköpostia sessionista, ohitetaan kuitin lähetys", {
            sessionId: fullSession.id,
          });
          break;
        }

        // Rakennetaan kuittiviesti
        const html = `
          <h2>Kiitos tilauksestasi!</h2>
          <p>Olet maksanut <strong>${amount} ${currency}</strong> Tuntihintasi-palvelun käytöstä.</p>
          <p>Päivämäärä: ${paidAt.toLocaleDateString("fi-FI")} klo ${paidAt.toLocaleTimeString("fi-FI")}</p>
          ${receiptUrl ? `<p><a href="${receiptUrl}">Avaa Stripe-kuitti</a></p>` : ""}
          <hr>
          <p>Tuntihintasi – E-P:n Sähkötekniikka</p>
        `;

        // Lähetetään kuitti Resendin kautta
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: email,
            subject: "Tuntihintasi – kuitti maksusta",
            html,
          }),
        });

        if (!r.ok) {
          const text = await r.text();
          console.error("❌ Resend failed:", text);
          return res.status(500).json({ ok: false, error: "resend_failed", detail: text });
        }

        const data = await r.json();
        console.log("✅ Kuitti lähetetty:", { sessionId: session.id, to: email, id: data?.id });
        break;
      }

      // Voit lisätä muita tapoja jos haluat:
      // case "invoice.payment_succeeded":
      // case "payment_intent.succeeded":
      default:
        // Ei tehdä mitään muihin eventteihin
        break;
    }

    // Vastataan 200 jotta Stripe lakkaa retryn
    return res.status(200).json({ ok: true, received: true });
  } catch (err: any) {
    console.error("❌ Webhook-käsittely epäonnistui:", err?.message ?? err);
    return res.status(500).json({ ok: false, error: "webhook_processing_failed" });
  }
}

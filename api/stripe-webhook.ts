// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

// TÄRKEÄ: raakabody allekirjoitukselle
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function getEmailFromEvent(event: Stripe.Event): Promise<string | null> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Yritetään kaikki polut
    let email =
      session.customer_details?.email ??
      session.customer_email ??
      null;

    if (!email && typeof session.customer === "string") {
      try {
        const cust = await stripe.customers.retrieve(session.customer);
        if (!("deleted" in cust) && cust.email) email = cust.email;
      } catch (e) {
        console.warn("Could not retrieve customer for session:", session.id, e);
      }
    }

    return email || null;
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    if (invoice.customer_email) return invoice.customer_email;

    if (typeof invoice.customer === "string") {
      try {
        const cust = await stripe.customers.retrieve(invoice.customer);
        if (!("deleted" in cust) && cust.email) return cust.email;
      } catch (e) {
        console.warn("Could not retrieve customer for invoice:", invoice.id, e);
      }
    }
    return null;
  }

  return null;
}

async function sendReceiptEmail(to: string, license: string, token: string) {
  const from = process.env.EMAIL_FROM!; // esim. no-reply@tuntihintasi.fi (domain verifioitu)
  const replyTo = process.env.EMAIL_REPLY_TO || to;

  const subject = "Tuntihintasi – kuitti ja tunnuskoodi";
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height:1.5">
      <h2>Kiitos tilauksesta!</h2>
      <p>Lisenssi on nyt aktivoitu. Alla tunnustieto:</p>
      <ul>
        <li><strong>Lisenssikoodi:</strong> ${license}</li>
        <li><strong>Kirjautumistunnus:</strong> ${token}</li>
      </ul>
      <p>Voit kirjautua sovellukseen syöttämällä tunnuksen kirjautumissivulla.</p>
      <p>Tarvitsetko apua? Vastaa tähän viestiin.</p>
      <hr/>
      <small>Lähetetty Resend-palvelulla.</small>
    </div>
  `;

  const result = await resend.emails.send({
    from,
    to,
    reply_to: replyTo,
    subject,
    html,
  });

  console.log("Resend response:", JSON.stringify(result));
  if ((result as any)?.error) {
    throw new Error(`Resend error: ${(result as any).error?.message || "unknown"}`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  let buf: Buffer;
  try {
    buf = await readRawBody(req);
  } catch (err: any) {
    console.error("Failed to read raw body:", err);
    res.status(400).send(`Failed to read body: ${err?.message || err}`);
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    console.error("Missing stripe-signature header");
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error("Signature verification failed:", err?.message || err);
    res.status(400).send(`Webhook signature verification failed: ${err?.message || err}`);
    return;
  }

  console.log("🔔 Stripe event received:", event.id, event.type);

  try {
    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const email = await getEmailFromEvent(event);
      console.log("Resolved email for event:", event.id, "=>", email);

      if (!email) {
        console.warn("No email resolved for event:", event.id);
        res.status(200).send("ok"); // ei kaadeta webhookia
        return;
      }

      const license = uuid().toUpperCase();
      const token = uuid().replace(/-/g, "").toUpperCase();

      await kv.set(
        `license:${email.toLowerCase()}`,
        JSON.stringify({ email, active: true, createdAt: Date.now(), evt: event.id }),
        { ex: 60 * 60 * 24 * 30 }
      );
      await kv.set(
        `token:${token}`,
        JSON.stringify({ license, createdAt: Date.now() }),
        { ex: 60 * 60 * 24 }
      );

      console.log("KV stored for email:", email, "license:", license, "token:", token);

      await sendReceiptEmail(email, license, token);
      console.log("Email sent to:", email, "for event:", event.id);
    }

    res.status(200).send("ok");
  } catch (err: any) {
    console.error("stripe-webhook error:", err?.message || err, err?.stack);
    // Palautetaan 200, ettei Stripe rippaa loputtomasti – mutta logit kertovat kaiken.
    res.status(200).send("ok");
  }
}


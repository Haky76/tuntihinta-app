// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

// Raakabody allekirjoituksen tarkistukseen
export const config = { api: { bodyParser: false } };

// Stripe ja Resend alustukset
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

// Raakabodyn luku
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Sähköposti Stripe-eventistä
async function getEmailFromEvent(event: Stripe.Event): Promise<string | null> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.customer_details?.email || session.customer_email || null;
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    if (invoice.customer_email) return invoice.customer_email;

    if (typeof invoice.customer === "string") {
      const customer = await stripe.customers.retrieve(invoice.customer);
      if (!customer.deleted) return (customer.email as string) || null;
    }
  }

  return null;
}

// PÄÄHANDLERI
export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.error("WEBHOOK DBG: VERSION=V1 @", new Date().toISOString());
  res.setHeader("x-webhook-version", "V1");

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  let buf: Buffer;
  try {
    buf = await readRawBody(req);
  } catch (err: any) {
    console.error("WEBHOOK readRawBody error:", err);
    res.status(400).send(`Failed to read body: ${err?.message || err}`);
    return;
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    console.error("WEBHOOK missing stripe-signature header");
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
    console.log("WEBHOOK event verified:", event.type, event.id);
  } catch (err: any) {
    console.error("WEBHOOK signature verification failed:", err?.message || err);
    res.status(400).send(`Webhook signature verification failed: ${err?.message}`);
    return;
  }

  try {
    const email = await getEmailFromEvent(event);
    console.log("WEBHOOK processing:", event.type, "email:", email);

    if (!email) {
      res.setHeader("x-webhook-dbg", "verified;email=missing");
      res.status(200).send("ok");
      return;
    }

    // Generoi lisenssi & token
    const license = uuid().toUpperCase();
    const token = uuid().replace(/-/g, "").toUpperCase();

    // KV-talletus
    await kv.set(
      `license:${email}`,
      JSON.stringify({ email, active: true, createdAt: Date.now(), evt: event.id }),
      { ex: 60 * 60 * 24 * 30 }
    );
    await kv.set(
      `token:${token}`,
      JSON.stringify({ license, createdAt: Date.now() }),
      { ex: 60 * 60 * 24 }
    );

    // Lähetä sähköposti Resendillä – HUOM! data/error-malli
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,   // esim. 'Tuntihintasi <no-reply@tuntihintasi.fi>'
      to: email,
      subject: "Tuntihintasi – kuitti ja tunnuskoodi",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Kiitos tilauksesta!</h2>
          <p>Lisenssisi on nyt aktivoitu.</p>
          <p><b>Lisenssikoodi:</b> ${license}<br/>
          <b>Kirjautumistunnus:</b> ${token}</p>
          <hr/>
          <small>Tämä viesti lähetettiin Resend-palvelun kautta (${process.env.EMAIL_FROM}).</small>
        </div>
      `,
      // Jos joskus haluat erillisen reply-osoitteen:
      // replyTo: process.env.EMAIL_REPLY_TO,
    });

    if (error) {
      console.error("Resend error:", error);
      res.setHeader("x-webhook-dbg", "verified;email=ok;kv=ok;mail=fail");
    } else {
      console.log("Resend sent, id:", data?.id);
      res.setHeader("x-webhook-dbg", "verified;email=ok;kv=ok;mail=ok");
    }

    res.status(200).send("ok");
  } catch (err: any) {
    console.error("WEBHOOK main error:", err);
    res.setHeader("x-webhook-dbg", "verified;exception");
    // Palautetaan 200, ettei Stripe retrya loputtomiin
    res.status(200).send("ok");
  }
}




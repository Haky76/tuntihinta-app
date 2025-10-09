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

// Funktio: lukee raakabodyn
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Funktio: poimii sähköpostin Stripe-tapahtumasta
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
      if (!customer.deleted) {
        return (customer.email as string) || null;
      }
    }
    return null;
  }

  return null;
}

// 🔧 PÄÄHANDLERI – VAIN YKSI!
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Debug-header ja -loki näkyvät Vercelin request-paneelissa
  console.error("WEBHOOK DBG: VERSION=V1 @", new Date().toISOString());
  res.setHeader("x-webhook-version", "V1");

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  let marks: string[] = [];

  try {
    let buf: Buffer;
    try {
      buf = await readRawBody(req);
    } catch (err: any) {
      console.error("readRawBody error:", err);
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
      marks.push(`verified`, `type=${event.type}`);
    } catch (err: any) {
      console.error("Signature verification failed:", err?.message || err);
      res.status(400).send(`Webhook signature verification failed: ${err?.message}`);
      return;
    }

    // Käsitellään halutut eventit
    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const email = await getEmailFromEvent(event);
      marks.push(email ? "email=found" : "email=missing");

      if (!email) {
        res.setHeader("x-webhook-dbg", marks.join(";"));
        res.status(200).send("ok");
        return;
      }

      // Generoidaan lisenssi ja token
      const license = uuid().toUpperCase();
      const token = uuid().replace(/-/g, "").toUpperCase();

      // Talletetaan KV:hen
      try {
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
        marks.push("kv=ok");
      } catch (kvErr: any) {
        console.error("KV error:", kvErr?.message || kvErr);
        marks.push("kv=fail");
      }

      // Lähetetään sähköposti Resendillä
      try {
        const { data, error } = await resend.emails.send({
          from: process.env.EMAIL_FROM!,           // esim. 'Tuntihintasi <no-reply@tuntihintasi.fi>'
          to: email,
          // replyTo: process.env.EMAIL_REPLY_TO,   // Jos haluat käyttää, pidä camelCase
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
        });

        if (error) {
          console.error("Resend error:", error);
          marks.push(`mail=fail:${String(error)}`);
        } else {
          marks.push(data?.id ? "mail=ok" : "mail=sent-no-id");
          console.log("Resend response id:", data?.id);
        }
      } catch (emailErr: any) {
        console.error("Resend thrown error:", emailErr?.message || emailErr);
        marks.push(`mail=fail-thrown`);
      }
    } else {
      marks.push("ignored");
    }

    // Palautetaan 200 (Stripe ei retrya) ja debug header
    res.setHeader("x-webhook-dbg", marks.join(";"));
    res.status(200).send("ok");
  } catch (err: any) {
    console.error("WEBHOOK fatal error:", err);
    res.setHeader("x-webhook-dbg", ["fatal"].join(";"));
    res.status(200).send("ok");
  }
}



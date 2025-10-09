// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

// TÄRKEÄ: raakabody allekirjoitusta varten
export const config = { api: { bodyParser: false } };

// Stripe & Resend
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

// Lue raakabody
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Poimi email Stripe-eventistä
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

// PÄÄHANDLERI
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Helppo versiotagi oikeaan laitaan Vercelissä / Stripe-responsessa
  res.setHeader("x-webhook-version", "dbg-v2");

  if (req.method !== "POST") {
    res.status(405).send("dbg:method-not-allowed");
    return;
  }

  const marks: string[] = [];

  // 1) Lue raakabody
  let buf: Buffer;
  try {
    buf = await readRawBody(req);
  } catch (err: any) {
    res.status(400).send(`dbg:readbody-fail:${err?.message || err}`);
    return;
  }

  // 2) Verifioi allekirjoitus
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) {
    res.status(400).send("dbg:no-stripe-signature");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
    marks.push("verified", `type=${event.type}`);
  } catch (err: any) {
    res.status(400).send(`dbg:bad-signature:${err?.message || err}`);
    return;
  }

  try {
    // 3) Kiinnostavat eventit
    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const email = await getEmailFromEvent(event);
      if (!email) {
        marks.push("email=missing");
        res.status(200).send(`dbg:${marks.join(";")}`);
        return;
      }
      marks.push("email=found");

      // 4) Generoi lisenssi ja token, talleta KV:hen
      const license = uuid().toUpperCase();
      const token = uuid().replace(/-/g, "").toUpperCase();

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
        marks.push(`kv=fail:${(kvErr?.message || kvErr + "").slice(0, 120)}`);
      }

      // 5) Lähetä kuittisähköposti Resendillä
      try {
        const from = process.env.EMAIL_FROM!;
        const replyTo = process.env.EMAIL_REPLY_TO || undefined; // camelCase

        const r = await resend.emails.send({
          from,
          to: email,
          ...(replyTo ? { replyTo } : {}),
          subject: "Tuntihintasi – kuitti ja tunnuskoodi",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
              <h2>Kiitos tilauksesta!</h2>
              <p>Lisenssisi on nyt aktivoitu.</p>
              <p><b>Lisenssikoodi:</b> ${license}<br/>
              <b>Kirjautumistunnus:</b> ${token}</p>
              <hr/>
              <small>Tämä viesti lähetettiin Resend-palvelun kautta (${from}).</small>
            </div>
          `,
        });

        marks.push(r?.data?.id ? "mail=ok" : "mail=sent-no-id");
      } catch (mailErr: any) {
        marks.push(`mail=fail:${(mailErr?.message || mailErr + "").slice(0, 160)}`);
      }
    } else {
      // Muiden eventtien kohdalla palauta silti 200
      marks.push("ignored");
    }

    res.status(200).send(`dbg:${marks.join(";")}`);
  } catch (err: any) {
    res.status(200).send(`dbg:handler-fail:${(err?.message || err + "").slice(0, 160)}`);
  }
}


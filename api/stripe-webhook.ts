// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

/**
 * TÄRKEÄ: Stripe-allekirjoitus tarvitsee raakabodyn, joten poistetaan bodyParser.
 */
export const config = { api: { bodyParser: false } };

/** Stripe & Resend */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

/** Pieni apuri raakabodyn lukemiseen */
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Poimi asiakkaan email Stripe-tapahtumasta */
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
      if (!("deleted" in customer) || !customer.deleted) {
        return (customer.email as string) || null;
      }
    }
    return null;
  }

  return null;
}

/** 🔧 VARSINAINEN WEBHOOK-HANDLER – vain yksi default-export! */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // näkyy Vercelin oikeassa laidassa response-headersissa
  res.setHeader("x-webhook-version", "V1");
  console.error("WEBHOOK DBG: VERSION=V1 @", new Date().toISOString());

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  let raw: Buffer;
  try {
    raw = await readRawBody(req);
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
    // HUOM: stripe.webhooks (ei 'webhook' eikä monikossa väärin)
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
    console.log("WEBHOOK event verified:", event.type, event.id);
  } catch (err: any) {
    console.error("WEBHOOK signature verification failed:", err?.message || err);
    res
      .status(400)
      .send(`Webhook signature verification failed: ${err?.message || err}`);
    return;
  }

  try {
    console.log("WEBHOOK processing event:", event.type);

    // käsitellään vain nämä
    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const email = await getEmailFromEvent(event);
      console.log("WEBHOOK extracted email:", email);

      if (!email) {
        console.warn("WEBHOOK: No email found, skipping send");
        res.status(200).send("ok");
        return;
      }

      // luodaan lisenssi & kirjautumistunnus
      const license = uuid().toUpperCase();
      const token = uuid().replace(/-/g, "").toUpperCase();

      console.log("WEBHOOK storing KV data...");
      await kv.set(
        `license:${email}`,
        JSON.stringify({
          email,
          active: true,
          createdAt: Date.now(),
          evt: event.id,
        }),
        { ex: 60 * 60 * 24 * 30 } // 30 päivää
      );
      await kv.set(
        `token:${token}`,
        JSON.stringify({
          license,
          createdAt: Date.now(),
        }),
        { ex: 60 * 60 * 24 } // 24 h
      );

      // lähetetään kuitti + tunnukset
      console.log("WEBHOOK sending email via Resend...");
      try {
        const { data, error } = await resend.emails.send({
          from: process.env.EMAIL_FROM!, // esim. 'Tuntihintasi <no-reply@tuntihintasi.fi>'
          to: email,
          // Jos haluat erillisen reply-osoitteen, käytä camelCasea:
          // replyTo: process.env.EMAIL_REPLY_TO,
          subject: "Tuntihintasi – kuitti ja tunnuskoodi",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
              <h2>Kiitos tilauksesta!</h2>
              <p>Lisenssisi on nyt aktivoitu.</p>
              <p>
                <b>Lisenssikoodi:</b> ${license}<br/>
                <b>Kirjautumistunnus:</b> ${token}
              </p>
              <p>Voit kirjautua sovellukseen syöttämällä yllä olevan tunnuksen kirjautumissivulla.</p>
              <hr/>
              <small>Tämä viesti lähetettiin Resend-palvelun kautta (${process.env.EMAIL_FROM}).</small>
            </div>
          `,
        });

        if (error) {
          console.error("WEBHOOK Resend error:", error);
        } else {
          console.log("WEBHOOK Resend ok, message id:", data?.id);
        }
      } catch (emailErr: any) {
        console.error("WEBHOOK Resend throw:", emailErr?.message || emailErr);
      }
    }

    // vastataan 200 aina, ettei Stripe retrya turhaan
    res.status(200).send("ok");
  } catch (err: any) {
    console.error("WEBHOOK main try/catch error:", err);
    res.status(200).send("ok");
  }
}




// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

// Webhookissa tarvitaan raakabody allekirjoituksen tarkistukseen
export const config = { api: { bodyParser: false } };

// ======= Alustukset =======
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

// Raakabodyn luku Vercelin req:stä
function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Poimi sähköpostiosoite Stripe-tapahtumasta
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
      if (!("deleted" in customer) || customer.deleted === false) {
        return (customer.email as string) || null;
      }
    }
  }

  return null;
}

// ======= PÄÄHANDLERI =======
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // debug-header näkyy Vercelin oikeassa reunassa
  res.setHeader("x-webhook-version", "dbg-v3");

  const marks: string[] = [];
  marks.push(`start method=${req.method}`);

  if (req.method !== "POST") {
    marks.push("bad-method");
    return res.status(405).json({ ok: false, error: "method-not-allowed", marks });
  }

  // 1) Lue raakabody
  let buf: Buffer;
  try {
    buf = await readRawBody(req);
    marks.push(`body=${buf.length}b`);
  } catch (e: any) {
    marks.push(`readBodyFail=${e?.message || String(e)}`);
    return res.status(400).json({ ok: false, error: "failed-to-read-body", detail: e?.message, marks });
  }

  // 2) Verifioi Stripe-allekirjoitus
  const sig = req.headers["stripe-signature"] as string | undefined;
  marks.push(`hasSig=${!!sig}`);
  if (!sig) {
    return res.status(400).json({ ok: false, error: "missing-stripe-signature", marks });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
    marks.push(`evOk type=${event.type} id=${event.id}`);
  } catch (e: any) {
    marks.push(`evFail=${e?.message || String(e)}`);
    return res.status(400).json({ ok: false, error: "signature-verification-failed", detail: e?.message, marks });
  }

  try {
    // 3) Käsittele kiinnostavat tapahtumat
    if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
      const email = await getEmailFromEvent(event);
      marks.push(`email=${email || "null"}`);

      if (!email) {
        marks.push("no-email-skip");
        return res.status(200).json({ ok: true, marks });
      }

      // 4) Luo lisenssi ja token
      const license = uuid().toUpperCase();
      const token   = uuid().replace(/-/g, "").toUpperCase();
      marks.push("license+token");

      // 5) Tallenna KV:hen
      try {
        await kv.set(
          `license:${email}`,
          JSON.stringify({ email, active: true, createdAt: Date.now(), evt: event.id }),
          { ex: 60 * 60 * 24 * 30 } // 30 vrk
        );
        await kv.set(
          `token:${token}`,
          JSON.stringify({ license, createdAt: Date.now() }),
          { ex: 60 * 60 * 24 } // 24 h
        );
        marks.push("kv:ok");
      } catch (kvErr: any) {
        marks.push(`kvFail=${kvErr?.message || String(kvErr)}`);
      }

      // 6) Lähetä kuittisähköposti Resendillä
      try {
        const from = process.env.EMAIL_FROM!;                            // esimerkki: 'Tuntihintasi <no-reply@tuntihintasi.fi>'
        const replyTo = process.env.EMAIL_REPLY_TO || undefined;         // HUOM: camelCase

        const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Kiitos tilauksesta!</h2>
            <p>Lisenssisi on nyt aktivoitu.</p>
            <p><b>Lisenssikoodi:</b> ${license}<br/>
            <b>Kirjautumistunnus:</b> ${token}</p>
            <hr/>
            <small>Tämä viesti lähetettiin Resend-palvelun kautta (${from}).</small>
          </div>
        `;

        const r = await resend.emails.send({
          from,
          to: email,
          replyTo,                        // vain jos määritelty
          subject: "Tuntihintasi – kuitti ja tunnuskoodi",
          html,
        });

        // Resend-tyypitys vaihtelee – haetaan id turvallisesti.
        const mailId =
          r && typeof (r as any).data?.id === "string"
            ? (r as any).data.id
            : null;

        marks.push(mailId ? `mailOk id=${mailId}` : "mailSentNoId");
      } catch (mailErr: any) {
        marks.push(`mailFail=${mailErr?.message || String(mailErr)}`);
      }
    } else {
      marks.push(`ignored type=${event.type}`);
    }

const out = { ok: true, marks };
console.error("WEBHOOK OUT >>>", JSON.stringify(out, null, 2));
await new Promise((resolve) => setTimeout(resolve, 200));
return res.status(200).json(out);

} catch (err: any) {
  const out = { ok: false, error: err?.message || String(err), marks };
console.error("WEBHOOK OUT >>>", JSON.stringify(out, null, 2));
await new Promise((resolve) => setTimeout(resolve, 200)); // pieni viive logien flush
return res.status(200).json(out);

}



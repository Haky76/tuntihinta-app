// api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { v4 as uuid } from "uuid";
import { Resend } from "resend";

// 🔐 Stripe tarvitsee raakabodyn allekirjoituksen tarkistukseen
export const config = { api: { bodyParser: false } };

// ===== Alustukset =====
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});
const resend = new Resend(process.env.RESEND_API_KEY as string);

// ===== Apurit =====
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
    return null;
  }

  return null;
}

// ===== PÄÄHANDLERI =====
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // näkyy Vercelin response-paneelin oikeassa reunassa
  res.setHeader("x-webhook-version", "dbg-v4");

  const marks: string[] = [];
  const setMarksHeader = () =>
    res.setHeader("x-marks", marks.join("|").slice(0, 500));

  // Varhainen meta-debug (näkyy, jos Vercel kerää console.log/error)
  console.error("WEBHOOK ENTER", {
    t: new Date().toISOString(),
    method: req.method,
    host: req.headers.host,
    vercelId: (req.headers["x-vercel-id"] as string) || null,
  });

  // 0) Check method
  if (req.method !== "POST") {
    marks.push("bad-method");
    setMarksHeader();
    return res
      .status(405)
      .json({ ok: false, error: "method-not-allowed", marks });
  }

  // 1) Lue raakabody
  let buf: Buffer;
  try {
    buf = await readRawBody(req);
    marks.push(`body=${buf.length}b`);
  } catch (e: any) {
    marks.push(`readBodyFail=${e?.message || String(e)}`);
    setMarksHeader();
    return res.status(400).json({
      ok: false,
      error: "failed-to-read-body",
      detail: e?.message,
      marks,
    });
  }

  // 2) Stripe-allekirjoitus
  const sig = req.headers["stripe-signature"] as string | undefined;
  marks.push(`hasSig=${!!sig}`);
  if (!sig) {
    setMarksHeader();
    return res
      .status(400)
      .json({ ok: false, error: "missing-stripe-signature", marks });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
    marks.push("sig:OK");
  } catch (e: any) {
    marks.push(`sigVerifyFail=${e?.message || String(e)}`);
    setMarksHeader();
    return res.status(400).json({
      ok: false,
      error: "signature-verification-failed",
      detail: e?.message,
      marks,
    });
  }

  marks.push(`evOk type=${event.type} id=${event.id}`);

  try {
    // 3) Käsitellään vain nämä
    if (
      event.type === "checkout.session.completed" ||
      event.type === "invoice.paid"
    ) {
      const email = await getEmailFromEvent(event);
      marks.push(`email=${email || "null"}`);

      if (!email) {
        marks.push("no-email-skip");
        setMarksHeader();
        return res.status(200).json({ ok: true, marks });
      }

      // 4) Generoi lisenssi + token
      const license = uuid().toUpperCase();
      const token = uuid().replace(/-/g, "").toUpperCase();
      marks.push("license+token");

      // 5) Talleta KV:hen
      try {
        await kv.set(
          `license:${email}`,
          JSON.stringify({
            email,
            active: true,
            createdAt: Date.now(),
            evt: event.id,
          }),
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
        const from = process.env.EMAIL_FROM!; // esim. 'Tuntihintasi <no-reply@tuntihintasi.fi>'
        const replyTo = process.env.EMAIL_REPLY_TO || undefined; // camelCase

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

        const { data, error } = await resend.emails.send({
          from,
          to: email,
          replyTo, // vain jos määritelty
          subject: "Tuntihintasi – kuitti ja tunnuskoodi",
          html,
        });

        const mailId =
          data && typeof (data as any).id === "string"
            ? (data as any).id
            : null;

        if (mailId) {
          marks.push(`mailOk id=${mailId}`);
        } else {
          marks.push(`mailSentNoId`);
        }

        if (error) {
          // Resend palauttaa virheen myös success-statuksella; logitetaan mutta ei kaadeta
          marks.push(`mailErr=${(error as any)?.message || String(error)}`);
        }
      } catch (mailErr: any) {
        marks.push(`mailFail=${mailErr?.message || String(mailErr)}`);
      }
    } else {
      // Muiden eventtien kohdalla vain hyväksytään, ettei Stripe retrya
      marks.push(`ignored type=${event.type}`);
    }

    // 7) ONNISTUI
    const out = { ok: true, marks };
    console.error("WEBHOOK OUT >>>", JSON.stringify(out, null, 2));
    // pieni viive, jotta console ehtii kerääntyä Vercelin paneeliin
    await new Promise((resolve) => setTimeout(resolve, 500));
    setMarksHeader();
    return res.status(200).json(out);
  } catch (err: any) {
    // 8) YLEINEN CATCH – palautetaan 200, ettei Stripe retrya loputtomasti
    const out = { ok: false, error: err?.message || String(err), marks };
    console.error("WEBHOOK OUT >>>", JSON.stringify(out, null, 2));
    await new Promise((resolve) => setTimeout(resolve, 500)); // viive logien flushiin
    setMarksHeader();
    return res.status(200).json(out);
  }
}

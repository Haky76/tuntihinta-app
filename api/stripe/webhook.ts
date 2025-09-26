// api/stripe/webhook.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import crypto from "node:crypto";
import { Resend } from "resend";
import { Redis } from "@upstash/redis";

export const config = {
  api: {
    bodyParser: false, // Stripe-signature verifiointiin
  },
};

function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const resend = new Resend(process.env.RESEND_API_KEY as string);
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL as string,
  token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) return res.status(400).send("Missing stripe-signature");

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email;

    if (email) {
      // Generoi lisenssiavain
      const licenseKey = crypto.randomBytes(16).toString("hex");

      // Tallenna Redis
      await redis.hset(`license:${email}`, {
        key: licenseKey,
        status: "active",
        stripe_checkout_id: session.id,
        created_at: Date.now().toString(),
      });

      // Lähetä sähköposti Resendillä
      await resend.emails.send({
        from: process.env.LICENSE_EMAIL_FROM as string,
        to: email,
        subject: process.env.LICENSE_EMAIL_SUBJECT as string,
        text:
          `Kiitos ostosta!\n\n` +
          `Lisenssiavaimesi tuntihinta-appiin:\n\n` +
          `${licenseKey}\n\n` +
          `Säilytä tämä viesti. Jos tarvitset apua, vastaa tähän sähköpostiin.`,
      });
    }
  }

  return res.status(200).json({ receive

// /api/stripe-webhook.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { kv } from '@vercel/kv'; // toimii Vercelissa automaattisesti
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://tuntihinta-app.vercel.app';
const EMAIL_FROM = process.env.EMAIL_FROM!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;

async function sendReceiptEmail(params: {
  to: string;
  sessionId: string;
  loginToken: string;
  amount?: number;
  currency?: string;
}) {
  // lähetetään Resendin RESTillä — ei tarvita SDK:ta
  const loginUrl = `${APP_BASE_URL}/login?token=${encodeURIComponent(params.loginToken)}`;
  const eur = params.amount ? (params.amount / 100).toFixed(2) : undefined;

  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.5">
    <h2 style="margin:0 0 8px">Kiitos ostosta!</h2>
    <p>Kuitti: Checkout-session <code>${params.sessionId}</code>.</p>
    ${eur ? `<p>Summa: <strong>${eur} ${String(params.currency).toUpperCase()}</strong></p>` : ''}
    <p style="margin-top:16px">
      <a href="${loginUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
        Kirjaudu sovellukseen yhdellä klikkauksella
      </a>
    </p>
    <p style="color:#64748b;margin-top:12px">Linkki on kertakäyttöinen ja vanhenee 24 tunnissa.</p>
  </div>`;

  const body = {
    from: EMAIL_FROM,
    to: params.to,
    subject: 'Tuntihintasi – kuitti ja kirjautumislinkki',
    html,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed', method: req.method });
  }
  if (!WEBHOOK_SECRET) {
    return res.status(500).json({ ok: false, error: 'missing_env' });
  }

  // Stripe vaatii raw-bodyn allekirjoituksen tarkistukseen
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    const buf = Buffer.isBuffer((req as any).rawBody)
      ? (req as any).rawBody
      : Buffer.from(JSON.stringify(req.body ?? {}));
    event = stripe.webhooks.constructEvent(buf, sig, WEBHOOK_SECRET);
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: 'invalid_signature', message: err.message });
  }

  // Käsitellään vain checkout.session.completed
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ ok: true, skipped: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // Idempotenssi: käsittele tämä session vain kerran
  const idemKey = `purchase:${session.id}`;
  const created = await kv.setnx(idemKey, '1');
  // Vanhenna idempotenssiavaimen esim. 7 pv kuluttua
  await kv.expire(idemKey, 60 * 60 * 24 * 7);
  if (!created) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  try {
    // 1) Poimi sähköposti ja summa
    const email =
      session.customer_details?.email ??
      (typeof session.customer_email === 'string' ? session.customer_email : undefined);
    if (!email) throw new Error('missing_email');

    // stripe: summa yleensä payment_intentissä
    let amount: number | undefined;
    let currency: string | undefined;

    if (typeof session.payment_intent === 'string') {
      const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
      amount = pi.amount_received ?? pi.amount;
      currency = pi.currency;
    } else if (session.amount_total && session.currency) {
      amount = session.amount_total;
      currency = session.currency;
    }

    // 2) Luo kertakäyttöinen login-token (24 h)
    const token = crypto.randomUUID();
    await kv.set(`login:${token}`, JSON.stringify({ email, sessionId: session.id, createdAt: Date.now() }), {
      ex: 60 * 60 * 24, // 24h
    });

    // 3) Lähetä kuitti & kirjautumislinkki
    await sendReceiptEmail({
      to: email,
      sessionId: session.id,
      loginToken: token,
      amount,
      currency,
    });

    // 4) Tallenna “ostotapahtuma” KV:hen (kevyt audit)
    await kv.set(
      `order:${session.id}`,
      JSON.stringify({
        sessionId: session.id,
        email,
        amount,
        currency,
        at: new Date().toISOString(),
      }),
      { ex: 60 * 60 * 24 * 30 } // säilytä 30 vrk
    );

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    // jos joku epäonnistui, voit halutessa poistaa idempotenssiavaimen
    // await kv.del(idemKey);
    return res.status(500).json({ ok: false, error: err.message ?? String(err) });
  }
}

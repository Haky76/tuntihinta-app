
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { kv } from '@vercel/kv';
import { v4 as uuid } from 'uuid';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: '2024-06-20' });

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed'); return;
  }

  let buf: Buffer;
  try { buf = await readRawBody(req); }
  catch (err: any) { res.status(400).send(`Failed to read body: ${err?.message || err}`); return; }

  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) { res.status(400).send('Missing stripe-signature header'); return; }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (err: any) {
    res.status(400).send(`Webhook signature verification failed: ${err.message}`); return;
  }

  if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
    const session = event.data.object as any;
    const email = session.customer_details?.email || session.customer_email || 'unknown@unknown';

    const license = uuid().toUpperCase();
    const token = uuid().replace(/-/g,'').toUpperCase();

    await kv.set(`license:${license}`, JSON.stringify({ email, active: true, createdAt: Date.now(), sessionId: session.id }));
    await kv.set(`token:${token}`, JSON.stringify({ license, createdAt: Date.now() }), { ex: 60 * 60 * 24 });
    await kv.set(`session:${session.id}`, JSON.stringify({ license, token, createdAt: Date.now() }), { ex: 60 * 60 * 24 * 7 });
  }

  res.status(200).send('ok');
}

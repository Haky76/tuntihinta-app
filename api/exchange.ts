
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, reason: 'method' }); return;
  }
  const token = (req.query?.token as string) || '';
  if (!token) { res.status(400).json({ ok: false, reason: 'missing token' }); return; }

  const data = await kv.get<string>(`token:${token}`);
  if (!data) { res.status(200).json({ ok: false }); return; }
  const { license } = JSON.parse(data);
  await kv.del(`token:${token}`);
  res.status(200).json({ ok: true, license });
}

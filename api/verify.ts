
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method' }); return;
  }
  let key: string | undefined;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    key = body?.key;
  } catch {}
  if (!key) {
    let raw = ''; await new Promise<void>((resolve)=>{ req.on('data',(c)=> raw += c); req.on('end',()=>resolve()); });
    try { key = JSON.parse(raw || '{}').key; } catch {}
  }
  if (!key) { res.status(200).json({ ok: false, reason: 'missing' }); return; }

  const data = await kv.get<string>(`license:${key}`);
  if (!data) { res.status(200).json({ ok: false }); return; }
  const lic = JSON.parse(data);
  if (lic.active !== true) { res.status(200).json({ ok: false }); return; }
  res.status(200).json({ ok: true });
}

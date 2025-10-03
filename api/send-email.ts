// api/send-email.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Minidiagnostiikka: ei importoi Resendiä, ei lue env:ejä.
// Tämän ei pitäisi voida kaatua.

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method_not_allowed', method: req.method });
      return;
    }

    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body ?? null);
    res.status(200).json({ ok: true, echo: body ?? null });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: 'diag_failed', message: err?.message || String(err) });
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

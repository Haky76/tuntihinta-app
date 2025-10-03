import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
    const EMAIL_FROM = process.env.EMAIL_FROM || '';
    const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || '';

    if (!RESEND_API_KEY) return res.status(500).json({ ok: false, error: 'missing_RESEND_API_KEY' });
    if (!EMAIL_FROM)      return res.status(500).json({ ok: false, error: 'missing_EMAIL_FROM' });

    const resend = new Resend(RESEND_API_KEY);

    // Body: { to, subject, html?, text? }
    const body = typeof req.body === 'string' ? safeParse(req.body) ?? {} : (req.body ?? {});
    const to = String(body?.to ?? '').trim();
    const subject = String(body?.subject ?? 'Tuntihintasi testiviesti');
    const html = (body?.html as string | undefined) ?? '<p>Hei! Tämä on testiviesti.</p>';
    const text = (body?.text as string | undefined) ?? undefined;

    if (!to) return res.status(400).json({ ok: false, error: 'missing_to' });

    const resp = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text,
      // 🔧 tämä on oikea nimi:
      replyTo: EMAIL_REPLY_TO || undefined,
    });

    res.status(200).json({ ok: true, id: (resp as any)?.data?.id ?? null });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: 'internal_error',
      message: err?.message || String(err),
      detail: err?.response?.data ?? null,
    });
  }
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }

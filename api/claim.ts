
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session_id = (req.query?.session_id as string) || "";
  if (!session_id) {
    res.status(400).json({ ok: false, reason: "missing session_id" });
    return;
  }
  const data = await kv.get<string>(`session:${session_id}`);
  if (!data) {
    res.status(200).json({ ok: false });
    return;
  }
  const { token, license } = JSON.parse(data);
  await kv.del(`session:${session_id}`);
  res.status(200).json({ ok: true, token, license });
}

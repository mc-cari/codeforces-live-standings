import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).end(); return; }
  const origin = req.headers.origin;
  try {
    if (origin && new URL(origin).host !== req.headers.host) { res.status(403).end(); return; }
  } catch { res.status(403).end(); return; }
  const base = process.env.NEXT_PUBLIC_LIVE_API_BASE_URL;
  const token = process.env.TELEMETRY_TOKEN;
  if (!base || !token) { res.status(503).end(); return; }
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/v1/telemetry`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body), signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    res.status(response.ok ? 204 : response.status === 400 ? 400 : 503).end();
  } catch { res.status(503).end(); }
}

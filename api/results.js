// Read back what has been submitted so far.
//
// Guarded by RESULTS_TOKEN because rater names are personal data. Set it in the
// Vercel project's environment variables; without it this route stays closed.
//
//   curl -H "Authorization: Bearer $RESULTS_TOKEN" https://<host>/api/results

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  const expected = process.env.RESULTS_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'RESULTS_TOKEN is not set on this deployment' });
  }
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (given !== expected) return res.status(401).json({ error: 'unauthorized' });

  try {
    const { blobs } = await list({ prefix: 'ratings/', limit: 1000 });
    const files = await Promise.all(blobs.map(async (b) => {
      const r = await fetch(b.url);
      return { pathname: b.pathname, uploadedAt: b.uploadedAt, body: await r.json() };
    }));

    const raters = files.map((f) => ({
      rater: f.body.rater,
      submitted: f.uploadedAt,
      rated: f.body.ratings.filter((x) => x.rating !== null).length,
      skipped: f.body.ratings.filter((x) => x.rating === null).length,
    }));

    return res.status(200).json({
      n_raters: files.length,
      raters,
      submissions: req.query.full === '1' ? files.map((f) => f.body) : undefined,
    });
  } catch (err) {
    console.error('results failed', err);
    return res.status(500).json({ error: 'could not read submissions' });
  }
}

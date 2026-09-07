// Receives one rater's completed sheet and stores it verbatim.
//
// This endpoint validates and stores. It never invents, defaults or repairs a
// rating: a clip the rater could not listen to arrives as null and is stored as
// null, because a fabricated data point is worse than a missing one.

import { put } from '@vercel/blob';

const MAX_BODY = 128 * 1024;
const MAX_ROWS = 500;

function invalid(body) {
  if (!body || typeof body !== 'object') return 'body must be an object';
  if (typeof body.rater !== 'string' || !body.rater.trim()) return 'rater is required';
  if (body.rater.length > 80) return 'rater name is too long';
  if (!Array.isArray(body.ratings) || body.ratings.length === 0) return 'ratings is required';
  if (body.ratings.length > MAX_ROWS) return 'too many ratings';
  for (const r of body.ratings) {
    if (!r || typeof r !== 'object') return 'each rating must be an object';
    if (!Number.isInteger(r.query_index) || r.query_index < 0) return 'bad query_index';
    if (!Number.isInteger(r.rank) || r.rank < 1) return 'bad rank';
    if (r.rating !== null && !(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) {
      return 'rating must be an integer 1-5, or null when the rater could not listen';
    }
  }
  return null;
}

const slug = (name) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rater';

export default async function handler(req, res) {
  // A downloaded copy of the page posts from a null origin. That is allowed:
  // the endpoint holds nothing private and validates everything it accepts.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'use POST' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY) return res.status(413).json({ error: 'body too large' });
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON' }); }
  }

  const problem = invalid(body);
  if (problem) return res.status(400).json({ error: problem });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `ratings/${slug(body.rater)}-${stamp}.json`;

  try {
    // A random suffix keeps a second submission from the same person from
    // silently overwriting the first. Which one counts is the researcher's
    // call, not this endpoint's.
    const blob = await put(path, JSON.stringify(body, null, 2), {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/json',
    });
    const answered = body.ratings.filter((r) => r.rating !== null).length;
    return res.status(200).json({ ok: true, stored: blob.pathname, answered });
  } catch (err) {
    console.error('blob put failed', err);
    return res.status(500).json({ error: 'could not store ratings' });
  }
}

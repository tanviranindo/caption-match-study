// Turn retrieval results into the study.json the app serves.
//
//   node scripts/build-study.mjs --examples examples.json --windows musiccaps.csv
//
// `examples.json` is a list of {query_caption, top3:[{clip_id, ytid, score}]}.
// `--windows` is optional: a CSV with ytid,start_s,end_s. It exists because a
// caption usually describes one ten-second excerpt somewhere inside a longer
// video, and a study that plays from 0:00 rates audio nobody described. A clip
// whose window is unknown is kept, but without a player, so the app asks the
// rater to skip it instead of implying 0:00 is right.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readWindows(csvPath) {
  if (!csvPath) return new Map();
  const rows = fs.readFileSync(csvPath, 'utf8').split('\n');
  const head = rows[0].split(',');
  const iId = head.indexOf('ytid');
  const iA = head.indexOf('start_s');
  const iB = head.indexOf('end_s');
  if (iId < 0 || iA < 0 || iB < 0) throw new Error('CSV needs ytid, start_s, end_s columns');
  const out = new Map();
  for (const row of rows.slice(1)) {
    const cells = row.split(',');
    const a = Number(cells[iA]);
    const b = Number(cells[iB]);
    if (cells[iId] && Number.isFinite(a) && Number.isFinite(b)) {
      out.set(cells[iId], [Math.round(a), Math.round(b)]);
    }
  }
  return out;
}

const examplesPath = arg('examples');
if (!examplesPath) {
  console.error('usage: node scripts/build-study.mjs --examples <file.json> [--windows <csv>] [--endpoint <url>] [--out public/study.json]');
  process.exit(1);
}

const examples = JSON.parse(fs.readFileSync(examplesPath, 'utf8'));
const windows = readWindows(arg('windows'));
const out = arg('out', 'public/study.json');

let total = 0;
let unknown = 0;
const queries = examples.map((ex) => ({
  caption: ex.query_caption,
  clips: ex.top3.map((c, i) => {
    total += 1;
    const win = windows.get(c.ytid) || [c.start_s, c.end_s];
    const [start, end] = win[0] == null ? [null, null] : win;
    if (start == null) unknown += 1;
    return {
      rank: i + 1,
      clip_id: c.clip_id ?? '',
      ytid: c.ytid ?? '',
      start_s: start,
      end_s: end ?? (start != null ? start + 10 : null),
    };
  }),
}));

const doc = {
  id: arg('id', 'caption-match'),
  title: arg('title', 'Music description study'),
  endpoint: arg('endpoint', null) || undefined,
  total,
  queries,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}: ${queries.length} descriptions, ${total} clips`);
if (unknown) console.log(`  ${unknown} clip(s) have no known window and will be shown without a player`);

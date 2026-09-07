// The window offsets and the rank/position split are the two things that
// silently invalidate a study if they break, so they are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function build(examples, csv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-'));
  const ex = path.join(dir, 'ex.json');
  const out = path.join(dir, 'study.json');
  fs.writeFileSync(ex, JSON.stringify(examples));
  const args = ['scripts/build-study.mjs', '--examples', ex, '--out', out];
  if (csv) {
    const c = path.join(dir, 'w.csv');
    fs.writeFileSync(c, csv);
    args.push('--windows', c);
  }
  execFileSync('node', args, { cwd: root, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const examples = [{
  query_caption: 'a sad piano ballad',
  top3: [
    { clip_id: 'a', ytid: 'AAA', score: 0.9 },
    { clip_id: 'b', ytid: 'BBB', score: 0.8 },
    { clip_id: 'c', ytid: 'CCC', score: 0.7 },
  ],
}];

test('clip windows come from the CSV, not from zero', () => {
  const doc = build(examples, 'ytid,start_s,end_s\nAAA,30,40\nBBB,150,160\nCCC,0,10\n');
  const clips = doc.queries[0].clips;
  assert.equal(clips[0].start_s, 30);
  assert.equal(clips[1].start_s, 150);
  assert.equal(clips[2].start_s, 0);
});

test('rank follows the order the model produced', () => {
  const doc = build(examples, 'ytid,start_s,end_s\nAAA,30,40\nBBB,150,160\nCCC,0,10\n');
  assert.deepEqual(doc.queries[0].clips.map((c) => c.rank), [1, 2, 3]);
  assert.equal(doc.queries[0].clips[0].clip_id, 'a');
});

test('a clip with no known window gets no offset rather than a wrong one', () => {
  const doc = build(examples, 'ytid,start_s,end_s\nAAA,30,40\n');
  const clips = doc.queries[0].clips;
  assert.equal(clips[0].start_s, 30);
  assert.equal(clips[1].start_s, null, 'unknown window must stay null, never 0');
  assert.equal(clips[2].start_s, null);
});

test('totals count every clip', () => {
  const doc = build(examples, 'ytid,start_s,end_s\nAAA,30,40\n');
  assert.equal(doc.total, 3);
  assert.equal(doc.queries.length, 1);
});

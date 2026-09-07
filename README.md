# Caption-match listening study

A small web app for asking people the question a retrieval model cannot answer
about itself: **does this audio actually match this description?**

A rater sees a written description, hears the clips a model retrieved for it,
and rates each one from 1 to 5. Ratings are submitted from the page and stored
server-side, so nobody has to email a file back.

It was built to run the human evaluation for a music retrieval project, but
nothing in it is specific to that model. Any task that produces
*(description → ranked audio clips)* can be evaluated with it.

---

## What it does that a generic survey form does not

**Plays the excerpt the description is actually about.** Captions in datasets
like MusicCaps describe one ten-second window, and that window is usually not at
the start — across the default study it runs to 6:50 into the source video. Each
clip here starts at its own offset and stops at the end of the window. A form
that pastes a plain link asks people about audio nobody described, and returns a
number that looks fine and means nothing.

**Hides the model's ranking.** Clips arrive ranked. A rater who notices that
order starts rating the ranking instead of the audio, which quietly inflates
agreement between rater and model — the exact thing the study is trying to
measure. Clips are shuffled per rater; the true rank is recorded and used for
scoring, and the position the rater saw is recorded alongside it so the ordering
effect can itself be checked.

**Treats "I could not listen" as an answer.** Videos get deleted and
region-blocked. That option is always one tap away and is stored as `null`, kept
distinct from a rating of 1. Nothing in the interface makes guessing easier than
admitting a gap.

**Records whether the clip was actually heard.** Playback is tracked through the
YouTube player API, so a rating given without the audio ever reaching the end of
its window can be identified afterwards rather than trusted blindly.

**Survives a closed tab.** Progress is kept on the device; reopening the link
carries on where the rater stopped.

---

## Requirements

**To run a study you need**

- A list of examples: `[{query_caption, top3: [{clip_id, ytid, score}]}]`
- Optionally a CSV of clip windows (`ytid,start_s,end_s`) — without it clips play
  from the beginning, which is only correct if your excerpts start there
- A Vercel account (free tier is enough) with a Blob store for submissions

**Rater requirements** — any modern browser, headphones, about 15 minutes for a
30-clip study. No account, no install.

**Methodological requirements this app enforces**

| Requirement | How it is met |
|---|---|
| Each clip is judged against the description it belongs to | Description is pinned above its own clips, one per screen |
| The audio heard is the audio described | Player is cued to `start_s` and stops at `end_s` |
| Presentation order must not leak the model's ranking | Per-rater shuffle; true rank stored separately |
| Missing data must stay missing | "Could not listen" stores `null`; scoring skips nulls |
| A partial study must not be reported as a whole one | Downstream scoring refuses below the minimum rater count |

---

## Setting up

```bash
git clone https://github.com/tanviranindo/caption-match-study
cd caption-match-study
npm install
```

Build the study data from your results:

```bash
node scripts/build-study.mjs \
  --examples path/to/examples.json \
  --windows  path/to/clip_windows.csv \
  --title    "Music description study"
```

That writes `public/study.json`, which is the only file you need to change
between studies.

Deploy, and connect a Blob store so submissions have somewhere to go:

```bash
vercel deploy --prod
vercel blob create-store study-ratings   # answer yes when it offers to link
```

Linking the store sets `BLOB_READ_WRITE_TOKEN` on the project automatically.

To read submissions back through the API rather than the dashboard, set a
`RESULTS_TOKEN` environment variable; until you do, `/api/results` stays closed.

---

## Collecting the results

Every submission is stored as one JSON file under `ratings/` in the Blob store:

```json
{
  "rater": "A. Rahman",
  "started_at": "2026-09-07T21:00:00.000Z",
  "finished_at": "2026-09-07T21:14:22.000Z",
  "ratings": [
    { "query_index": 0, "rank": 1, "shown_position": 3,
      "clip_id": "581356124", "rating": 4, "listened": true }
  ]
}
```

`rank` is the model's ordering and is what you analyse. `shown_position` is
where that clip appeared for this rater. `rating` is `null` when the rater could
not listen. `listened` says whether playback reached the end of the window.

Read them with the API:

```bash
curl -H "Authorization: Bearer $RESULTS_TOKEN" https://<your-host>/api/results
curl -H "Authorization: Bearer $RESULTS_TOKEN" "https://<your-host>/api/results?full=1"
```

or with the Vercel CLI:

```bash
vercel blob list --prefix ratings/
```

---

## Layout

```
public/
  index.html      shell
  app.js          study logic: shuffling, playback, persistence, submission
  style.css
  study.json      the stimuli — the only file that changes between studies
api/
  submit.js       validates and stores one submission
  results.js      token-guarded read-back
scripts/
  build-study.mjs turns retrieval results into study.json
docs/
  REQUIREMENTS.md what the study has to satisfy, and why
```

## Licence

MIT. See `LICENSE`.

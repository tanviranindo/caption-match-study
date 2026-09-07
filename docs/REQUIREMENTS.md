# Requirements

What this app has to get right, why each one matters, and how it is met. The
reasons are recorded because most of these look like details until they silently
invalidate a result.

## R1 — A rater hears the audio the description describes

**Why.** Caption datasets annotate a fixed-length excerpt of a longer recording.
In MusicCaps every caption covers a ten-second window, and those windows are
mostly not at 0:00 — in the default study they reach 6:50 into the source video.
If playback starts at the beginning, raters judge audio that no annotator ever
described. The resulting mean is not a weak result; it is a meaningless one, and
it looks identical to a real one.

**Met by.** Each clip carries `start_s` and `end_s`. The player starts at
`start_s` and stops at `end_s`. A clip whose window is unknown is shown *without*
a player and the rater is asked to skip it, rather than defaulting to 0:00.

## R2 — Presentation order must not reveal the model's ranking

**Why.** Stimuli arrive ordered by model confidence. Shown in that order, a
rater who spots the pattern begins rating position rather than audio, which
inflates the correlation between human judgement and model score — precisely the
quantity a listening study exists to measure independently.

**Met by.** Clip order within a description, and the order of descriptions, are
shuffled per rater. The model's `rank` is stored for analysis; `shown_position`
is stored so the ordering effect can be tested rather than assumed absent.

## R3 — Missing data stays missing

**Why.** Videos are deleted and region-blocked. If the interface makes skipping
awkward, raters guess, and a guess is indistinguishable from a judgement once it
is in the file. That corrupts the result in the direction of noise while looking
like completeness.

**Met by.** "I could not listen to this clip" sits beside every rating and stores
`null`. The submit endpoint accepts `null` and never substitutes a value.
Downstream scoring skips nulls rather than treating them as low ratings.

## R4 — The result must be attributable and countable

**Why.** A study reported as "listeners rated…" needs to say how many, and be
able to show per-rater data if challenged.

**Met by.** Each submission is one file carrying the rater's name, start and
finish timestamps, and every judgement. Second submissions from the same name
are kept as separate files rather than overwriting.

## R5 — Submission must not depend on the rater doing extra work

**Why.** Asking volunteers to download a file and send it back loses responses,
and the losses are not random — the least motivated raters drop out first.

**Met by.** The page POSTs on completion and reports success or failure in
plain language. Download remains as a fallback when the POST fails.

## R6 — Interrupted sessions must survive

**Why.** Thirty judgements is longer than one sitting on a phone. Losing
progress means abandonment.

**Met by.** State is persisted to `localStorage` after every interaction and
restored on reopening. Nothing is sent until the rater finishes.

## R7 — Personal data is minimal and protected

**Why.** The study collects a name, which is personal data, and volunteers were
told what is recorded.

**Met by.** Only the name the rater types and their ratings are stored — no
identifiers, no analytics. The read-back endpoint is closed unless
`RESULTS_TOKEN` is set, and the welcome screen states exactly what is kept.

## Non-requirements

Deliberately out of scope: rater recruitment and payment, screening or
qualification tests, MUSHRA-style hidden references and anchors, and
inter-session counterbalancing across many raters. Studies needing those should
use an established framework such as
[webMUSHRA](https://github.com/audiolabs/webMUSHRA) or
[Go Listen](https://golisten.ucd.ie/).

// Caption-match listening study.
//
// Three things here are methodology, not UI polish, and should not be
// "simplified" away:
//
//   1. Clips are shown in a random order per rater. The stimuli arrive ranked
//      by the model, and a rater who notices that ordering starts rating the
//      rank instead of the audio. The true rank is recorded; only the
//      presentation order is shuffled.
//   2. A clip plays exactly the window its caption describes and stops there.
//      Captions describe one ten-second excerpt, often minutes into a video;
//      letting playback run on means the rater judges audio nobody described.
//   3. "I could not listen" is a first-class answer, stored as null. A guessed
//      rating is worse than a missing one, so the interface never makes
//      guessing the path of least resistance.

// Resolved from study.json once it loads. An absolute URL there lets a
// downloaded copy of this page submit to the hosted endpoint; the default
// relative path is what the deployed site uses.
let ENDPOINT = "/api/submit";
const STORE_KEY = "caption-match-study/v1";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const stepEl = document.getElementById("step");
const fillEl = document.getElementById("fill");

let study = null;
const state = {
  rater: "",
  step: -1,        // -1 welcome, 0..n-1 queries, n done
  order: [],       // query order for this rater
  shuffle: {},     // qi -> array of clip indexes in presentation order
  ratings: {},     // "qi:rank" -> 1..5
  skipped: {},     // "qi:rank" -> true
  played: {},      // "qi:rank" -> true once the window has been heard
  startedAt: null,
  sent: false,
};
const players = new Map();

/* ---------- helpers ---------- */
const key = (qi, rank) => `${qi}:${rank}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function shuffled(n, seed) {
  const a = [...Array(n).keys()];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const prev = JSON.parse(raw);
    if (!prev || prev.sent || prev.step < 0) return false;
    Object.assign(state, prev);
    return true;
  } catch { return false; }
}

function decided(qi, rank) {
  return state.ratings[key(qi, rank)] != null || state.skipped[key(qi, rank)];
}
function queryDone(qi) {
  return study.queries[qi].clips.every((c) => decided(qi, c.rank));
}
function doneCount() {
  let n = 0;
  study.queries.forEach((q, qi) => q.clips.forEach((c) => { if (decided(qi, c.rank)) n++; }));
  return n;
}

/* ---------- YouTube playback, bounded to the described window ---------- */
let ytReady = null;
function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
    setTimeout(() => resolve(window.YT || null), 8000);
  });
  return ytReady;
}

async function mount(slot, clip, qi) {
  const YT = await loadYT();
  const host = document.getElementById(slot);
  if (!host || !YT?.Player) return null;

  const player = new YT.Player(slot, {
    videoId: clip.ytid,
    playerVars: {
      start: clip.start_s, end: clip.end_s,
      rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin,
    },
    events: {
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED || e.data === YT.PlayerState.PAUSED) {
          const t = player.getCurrentTime?.() ?? 0;
          // Heard it if playback reached the end of the described window.
          if (t >= clip.end_s - 1.5) {
            state.played[key(qi, clip.rank)] = true;
            save();
            const badge = document.querySelector(`[data-heard="${key(qi, clip.rank)}"]`);
            if (badge) badge.textContent = "listened";
          }
        }
      },
      onError: () => {
        const alt = document.querySelector(`[data-alt="${key(qi, clip.rank)}"]`);
        if (alt) alt.hidden = false;
      },
    },
  });
  players.set(slot, player);
  return player;
}

function teardown() {
  players.forEach((p) => { try { p.destroy(); } catch { /* already gone */ } });
  players.clear();
}

/* ---------- screens ---------- */
function render() {
  teardown();
  if (state.step < 0) return welcome();
  if (state.step >= study.queries.length) return finish();
  return question(state.step);
}

function welcome() {
  stepEl.textContent = "";
  fillEl.style.width = "0%";
  const resumable = doneCount() > 0;
  view.innerHTML = `
    ${resumable ? `<p class="resume">You have ${doneCount()} of ${study.total} ratings saved
      on this device. Starting again keeps them.</p>` : ""}
    <h1>Does the music match the description?</h1>
    <p class="lede">You will see ${study.queries.length} short written descriptions of music.
      Each comes with ${study.queries[0].clips.length} clips that a machine-learning model
      picked out as matching it. Your job is to say how well each clip actually fits the words.</p>
    <p class="lede">There are no right answers, and nothing is being tested about you.
      Rate what you hear, not whether you like the music.</p>
    <label class="field"><span>Your name or initials</span>
      <input type="text" id="rater" autocomplete="name" placeholder="e.g. A. Rahman"
             value="${esc(state.rater)}"></label>
    <dl class="facts">
      <div><dt>Time needed</dt><dd>About 15 minutes</dd></div>
      <div><dt>What is recorded</dt><dd>Your ratings and the name you type. Nothing else.</dd></div>
      <div><dt>Purpose</dt><dd>Evaluating a music retrieval model for a university
        neural networks course project</dd></div>
      <div><dt>Audio</dt><dd>Each clip plays the exact ten seconds its description
        refers to, then stops</dd></div>
      <div><dt>If you stop</dt><dd>Your progress is kept on this device; reopen the
        link to carry on</dd></div>
    </dl>`;
  nav.innerHTML = `<span class="spacer"></span>
    <button class="primary" id="go">${resumable ? "Carry on" : "Start rating"}</button>`;

  const input = document.getElementById("rater");
  const go = document.getElementById("go");
  input.addEventListener("input", () => { state.rater = input.value; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  go.addEventListener("click", () => {
    if (!input.value.trim()) { input.focus(); return; }
    state.rater = input.value.trim();
    state.startedAt = state.startedAt || Date.now();
    if (!state.order.length) {
      const seed = Math.floor(Math.random() * 1e9);
      state.order = shuffled(study.queries.length, seed);
      study.queries.forEach((q, qi) => {
        state.shuffle[qi] = shuffled(q.clips.length, seed + qi + 1);
      });
    }
    state.step = 0;
    save(); render(); focusTop();
  });
}

function question(step) {
  const qi = state.order[step];
  const q = study.queries[qi];
  const positions = state.shuffle[qi] || [...Array(q.clips.length).keys()];

  stepEl.textContent = `Description ${step + 1} of ${study.queries.length}`;
  fillEl.style.width = `${((doneCount() / study.total) * 100).toFixed(1)}%`;

  const blocks = positions.map((ci, shown) => {
    const c = q.clips[ci];
    const k = key(qi, c.rank);
    const chosen = state.ratings[k];
    const skipped = !!state.skipped[k];
    const slot = `yt-${qi}-${c.rank}`;
    const playable = c.ytid && c.start_s != null;
    return `
      <section class="clip">
        <div class="clip-head">
          <span class="clip-name">Clip ${shown + 1} of ${positions.length}</span>
          <span class="heard" data-heard="${k}">${state.played[k] ? "listened" : ""}</span>
        </div>
        ${playable ? `
          <div class="stage">
            <div id="${slot}"></div>
            <button class="cover" data-play="${slot}">
              <strong>▶ Play ten seconds</strong>
              <span>from ${mmss(c.start_s)}</span>
            </button>
          </div>
          <p class="altlink" data-alt="${k}" hidden>This clip will not play here.
            <a href="https://www.youtube.com/watch?v=${encodeURIComponent(c.ytid)}&t=${c.start_s}s"
               target="_blank" rel="noopener">Open it on YouTube at ${mmss(c.start_s)}</a>,
            or mark that you could not listen.</p>
        ` : `<p class="altlink">No audio is available for this clip. Please mark that
             you could not listen to it.</p>`}
        <div class="scale" data-k="${k}" role="group" aria-label="Rating for clip ${shown + 1}">
          ${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-v="${v}"
             aria-pressed="${chosen === v}">${v}</button>`).join("")}
        </div>
        <div class="legend"><span>1 — unrelated</span><span>5 — matches closely</span></div>
        <p class="skip"><button type="button" data-skip="${k}" aria-pressed="${skipped}">
          ${skipped ? "Marked as could not listen" : "I could not listen to this clip"}
        </button></p>
      </section>`;
  }).join("");

  view.innerHTML = `
    <div class="caption-wrap"><p class="caption">${esc(q.caption)}</p></div>
    <p class="ask">How well does each clip fit that description?</p>
    ${blocks}`;

  view.querySelectorAll("[data-play]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slot = btn.dataset.play;
      btn.remove();
      const [, qq, rank] = slot.split("-").map(Number);
      const clip = study.queries[qq].clips.find((c) => c.rank === rank);
      const p = await mount(slot, clip, qq);
      if (p) setTimeout(() => { try { p.playVideo(); } catch { /* autoplay blocked */ } }, 400);
    });
  });
  view.querySelectorAll(".scale").forEach((grp) => {
    grp.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      state.ratings[grp.dataset.k] = Number(b.dataset.v);
      delete state.skipped[grp.dataset.k];
      save(); redrawControls(qi);
    }));
  });
  view.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.skip;
    if (state.skipped[k]) delete state.skipped[k];
    else { state.skipped[k] = true; delete state.ratings[k]; }
    save(); redrawControls(qi);
  }));

  drawNav(step, qi);
}

// Repaint only the controls, so choosing a rating never tears down a playing
// clip -- a rater who has to restart the audio to change their mind will not
// change their mind.
function redrawControls(qi) {
  view.querySelectorAll(".scale").forEach((grp) => {
    const chosen = state.ratings[grp.dataset.k];
    grp.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(chosen === Number(b.dataset.v)));
    });
  });
  view.querySelectorAll("[data-skip]").forEach((b) => {
    const on = !!state.skipped[b.dataset.skip];
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Marked as could not listen" : "I could not listen to this clip";
  });
  fillEl.style.width = `${((doneCount() / study.total) * 100).toFixed(1)}%`;
  drawNav(state.step, qi);
}

function drawNav(step, qi) {
  const last = step === study.queries.length - 1;
  const ready = queryDone(qi);
  nav.innerHTML =
    (step > 0 ? `<button class="ghost" id="back">Back</button>` : "") +
    `<span class="spacer"></span>` +
    (ready ? "" : `<span class="hint">Rate all ${study.queries[qi].clips.length} clips to continue</span>`) +
    `<button class="primary" id="next"${ready ? "" : " disabled"}>${last ? "Finish and send" : "Continue"}</button>`;
  document.getElementById("back")?.addEventListener("click", () => {
    state.step--; save(); render(); focusTop();
  });
  document.getElementById("next").addEventListener("click", () => {
    state.step++; save(); render(); focusTop();
  });
}

function focusTop() { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }

/* ---------- submission ---------- */
function payload() {
  const rows = [];
  study.queries.forEach((q, qi) => q.clips.forEach((c) => {
    const k = key(qi, c.rank);
    const shownAt = (state.shuffle[qi] || []).indexOf(q.clips.indexOf(c));
    rows.push({
      query_index: qi,
      rank: c.rank,                       // the model's rank: what scoring uses
      shown_position: shownAt >= 0 ? shownAt + 1 : null,  // where the rater saw it
      clip_id: c.clip_id,
      rating: state.ratings[k] ?? null,
      listened: !!state.played[k],
    });
  }));
  return {
    rater: state.rater,
    study: study.id || "caption-match",
    started_at: state.startedAt ? new Date(state.startedAt).toISOString() : null,
    finished_at: new Date().toISOString(),
    ratings: rows,
  };
}

function download() {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rating_${state.rater.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
  a.click();
}

function finish() {
  stepEl.textContent = "Finished";
  fillEl.style.width = "100%";
  const rated = Object.keys(state.ratings).length;
  const missed = Object.keys(state.skipped).length;
  view.innerHTML = `
    <p class="tick">Thank you</p>
    <h1>That is everything</h1>
    <p class="lede" id="msg">Sending your ${rated} rating${rated === 1 ? "" : "s"}…</p>
    ${missed ? `<p class="quiet">${missed} clip${missed === 1 ? " was" : "s were"} marked as
      not listenable. That is recorded as a gap, not as a low score.</p>` : ""}
    <p class="quiet">You can close this page once it says your ratings are saved.</p>
    <p class="status" id="status"></p>`;
  nav.innerHTML = `<span class="spacer"></span>
    <button class="ghost" id="dl">Download a copy</button>
    <button class="primary" id="retry" hidden>Try again</button>`;
  document.getElementById("dl").addEventListener("click", download);
  document.getElementById("retry").addEventListener("click", send);
  send();
}

async function send() {
  const msg = document.getElementById("msg");
  const status = document.getElementById("status");
  const retry = document.getElementById("retry");
  status.className = "status";
  status.textContent = "";
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.json();
    state.sent = true;
    save();
    msg.textContent = "Saved. Nothing else is needed from you.";
    retry.hidden = true;
  } catch (e) {
    msg.textContent = "Your ratings could not be sent automatically.";
    status.className = "status err";
    status.textContent = `Download a copy and send it to the researcher. (${e.message})`;
    retry.hidden = false;
  }
}

window.addEventListener("beforeunload", (e) => {
  if (state.step >= 0 && !state.sent && doneCount() > 0) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- boot ---------- */
(async function boot() {
  try {
    const r = await fetch("./study.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    study = await r.json();
    if (study.endpoint) ENDPOINT = study.endpoint;
  } catch (e) {
    view.innerHTML = `<h1>The study could not load</h1>
      <p class="lede">${esc(e.message)}. Refresh the page, or tell the researcher.</p>`;
    return;
  }
  restore();
  render();
})();

// Caption-match listening study.
//
// Methodology, not decoration -- do not "simplify" these away:
//
//   1. One clip per screen, and clips are shuffled per rater. Stimuli arrive
//      ranked by the model; a rater who notices that order starts rating the
//      ranking instead of the audio, inflating the very agreement the study
//      exists to measure. The true rank is recorded, the shown position too.
//   2. A clip plays exactly the window its caption describes and stops there.
//      Captions annotate one excerpt, usually not at 0:00; playing from the
//      start asks people about audio nobody described.
//   3. "I could not listen" is stored as null and kept distinct from a 1. A
//      guessed rating is worse than a missing one.
//
// The page occupies exactly one viewport and never scrolls between judgements:
// thirty small decisions should cost thirty taps, not thirty scrolls.

let ENDPOINT = "/api/submit";
const STORE_KEY = "caption-match-study/v2";
const ADVANCE_MS = 420;   // long enough to see the choice register

const bodyEl = document.getElementById("body");
const footEl = document.getElementById("foot");
const stepEl = document.getElementById("step");
const fillEl = document.getElementById("fill");

let study = null;
let items = [];           // flat list of judgements, in this rater's order
let player = null;        // one YouTube player, reused for every clip
let playerReady = false;
let canAutoplay = false;  // becomes true once a play has succeeded
let advanceTimer = null;
let direction = "fwd";

const state = {
  rater: "", step: -1, seed: 0,
  ratings: {}, skipped: {}, played: {},
  startedAt: null, sent: false,
};

/* ---------- helpers ---------- */
const key = (qi, rank) => `${qi}:${rank}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function shuffled(n, seed) {
  const a = [...Array(n).keys()];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Descriptions are shuffled, and clips shuffled within their description, but
// a description's clips stay together so the caption is read once, not thrice.
function buildItems(seed) {
  const out = [];
  shuffled(study.queries.length, seed).forEach((qi) => {
    const q = study.queries[qi];
    shuffled(q.clips.length, seed + qi + 1).forEach((ci, shown) => {
      out.push({ qi, caption: q.caption, clip: q.clips[ci], shown: shown + 1, of: q.clips.length });
    });
  });
  return out;
}

function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
function restore() {
  try {
    const prev = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!prev || prev.sent || prev.step < 0 || !prev.seed) return false;
    Object.assign(state, prev);
    return true;
  } catch { return false; }
}
const decided = (it) => state.ratings[key(it.qi, it.clip.rank)] != null
  || state.skipped[key(it.qi, it.clip.rank)];
const doneCount = () => items.filter(decided).length;

/* ---------- one persistent player ---------- */
function loadAPI() {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
    setTimeout(() => resolve(window.YT || null), 8000);
  });
}

// Reusing one player instead of mounting an iframe per screen keeps the
// transition from flashing and makes each clip appear instantly.
async function ensurePlayer(slotId) {
  const YT = await loadAPI();
  if (!YT?.Player) return null;
  player = new YT.Player(slotId, {
    playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
    events: {
      onReady: () => { playerReady = true; cueCurrent(); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) canAutoplay = true;
        const it = items[state.step];
        if (!it) return;
        if (e.data === YT.PlayerState.ENDED || e.data === YT.PlayerState.PAUSED) {
          const t = player.getCurrentTime?.() ?? 0;
          if (it.clip.end_s != null && t >= it.clip.end_s - 1.5) {
            state.played[key(it.qi, it.clip.rank)] = true;
            save();
            const b = document.getElementById("heard");
            if (b) b.textContent = "listened";
          }
        }
      },
      onError: () => {
        const a = document.getElementById("alt");
        if (a) a.hidden = false;
      },
    },
  });
  return player;
}

function cueCurrent() {
  const it = items[state.step];
  if (!it || !player || !playerReady || !it.clip.ytid || it.clip.start_s == null) return;
  const opts = {
    videoId: it.clip.ytid,
    startSeconds: it.clip.start_s,
    endSeconds: it.clip.end_s,
  };
  // Autoplay only after the rater has played something themselves; browsers
  // block it before that, and a silently failed autoplay looks like a bug.
  if (canAutoplay) player.loadVideoById(opts);
  else player.cueVideoById(opts);
}

/* ---------- screens ---------- */
function render() {
  clearTimeout(advanceTimer);
  if (state.step < 0) return welcome();
  if (state.step >= items.length) return finish();
  return judge();
}

function welcome() {
  stepEl.textContent = "";
  fillEl.style.width = "0%";
  const resume = state.seed && doneCount() > 0;
  bodyEl.innerHTML = `
    <div class="sheet slide">
      ${resume ? `<p class="resume">You have ${doneCount()} of ${items.length} answers saved
        on this device. Carrying on keeps them.</p>` : ""}
      <h1>Does the music match the description?</h1>
      <p class="lede">You will read short descriptions of music and hear the clips a
        machine-learning model picked out for them. For each clip, say how well it fits
        the words. One clip per screen, ${study.total} in total.</p>
      <p class="lede">There are no right answers. Rate what you hear, not whether you
        like the music.</p>
      <label class="field"><span>Your name or initials</span>
        <input type="text" id="rater" autocomplete="name" placeholder="e.g. A. Rahman"
               value="${esc(state.rater)}"></label>
      <dl class="facts">
        <div><dt>Time needed</dt><dd>About 15 minutes</dd></div>
        <div><dt>What is recorded</dt><dd>Your ratings and the name you type. Nothing else.</dd></div>
        <div><dt>Audio</dt><dd>Each clip plays the exact ten seconds its description
          refers to, then stops</dd></div>
        <div><dt>If you stop</dt><dd>Progress is kept on this device — reopen the link
          to carry on</dd></div>
      </dl>
    </div>`;
  footEl.innerHTML = `<div class="controls"><span class="spacer"></span>
    <button class="primary" id="go">${resume ? "Carry on" : "Start"}</button></div>`;

  const input = document.getElementById("rater");
  const go = document.getElementById("go");
  input.addEventListener("input", () => { state.rater = input.value; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  go.addEventListener("click", () => {
    if (!input.value.trim()) return input.focus();
    state.rater = input.value.trim();
    state.startedAt = state.startedAt || Date.now();
    if (!state.seed) {
      state.seed = Math.floor(Math.random() * 1e9);
      items = buildItems(state.seed);
    }
    state.step = 0; direction = "fwd";
    save(); render();
  });
}

function judge() {
  const it = items[state.step];
  const k = key(it.qi, it.clip.rank);
  const chosen = state.ratings[k];
  const skipped = !!state.skipped[k];
  const playable = it.clip.ytid && it.clip.start_s != null;

  stepEl.textContent = `${state.step + 1} of ${items.length}`;
  fillEl.style.width = `${((doneCount() / items.length) * 100).toFixed(1)}%`;

  bodyEl.innerHTML = `
    <div class="body slide${direction === "back" ? " back" : ""}"
         style="display:contents">
      <div class="caption-wrap"><p class="caption">${esc(it.caption)}</p></div>
      <div class="clipbar">
        <span>Clip ${it.shown} of ${it.of} for this description</span>
        <span class="heard" id="heard">${state.played[k] ? "listened" : ""}</span>
      </div>
      ${playable
        ? `<div class="stage"><div id="ytslot"></div></div>
           <p class="altlink" id="alt" hidden>This clip will not play here —
             <a href="https://www.youtube.com/watch?v=${encodeURIComponent(it.clip.ytid)}&t=${it.clip.start_s}s"
                target="_blank" rel="noopener">open it on YouTube at ${mmss(it.clip.start_s)}</a>,
             or mark that you could not listen.</p>`
        : `<div class="stage"></div>
           <p class="altlink">No audio is available for this clip — please mark that
             you could not listen to it.</p>`}
      <div class="scale" role="group" aria-label="Your rating">
        ${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-v="${v}"
          aria-pressed="${chosen === v}">${v}</button>`).join("")}
      </div>
      <div class="legend"><span>1 — unrelated</span><span>5 — matches closely</span></div>
    </div>`;

  footEl.innerHTML = `
    <button class="link" id="skip" aria-pressed="${skipped}">
      ${skipped ? "Marked as could not listen" : "I could not listen to this clip"}
    </button>
    <div class="controls">
      ${state.step > 0 ? `<button class="ghost" id="back">Back</button>` : ""}
      <span class="spacer"></span>
      <button class="primary" id="next"${decided(it) ? "" : " disabled"}>
        ${state.step === items.length - 1 ? "Finish" : "Next"}</button>
    </div>`;

  // Mount the player once; afterwards just swap the video into it.
  const slot = document.getElementById("ytslot");
  if (playable) {
    if (!player) ensurePlayer("ytslot");
    else if (slot) { slot.replaceWith(player.getIframe()); cueCurrent(); }
  }

  bodyEl.querySelectorAll(".scale button").forEach((b) => {
    b.addEventListener("click", () => {
      state.ratings[k] = Number(b.dataset.v);
      delete state.skipped[k];
      save();
      bodyEl.querySelectorAll(".scale button").forEach((o) =>
        o.setAttribute("aria-pressed", String(o === b)));
      document.getElementById("next").disabled = false;
      fillEl.style.width = `${((doneCount() / items.length) * 100).toFixed(1)}%`;
      // Advance on its own: thirty judgements should not need sixty taps.
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => { direction = "fwd"; state.step++; save(); render(); }, ADVANCE_MS);
    });
  });
  document.getElementById("skip").addEventListener("click", () => {
    if (state.skipped[k]) delete state.skipped[k];
    else { state.skipped[k] = true; delete state.ratings[k]; }
    save(); render();
  });
  document.getElementById("back")?.addEventListener("click", () => {
    clearTimeout(advanceTimer); direction = "back"; state.step--; save(); render();
  });
  document.getElementById("next").addEventListener("click", () => {
    clearTimeout(advanceTimer); direction = "fwd"; state.step++; save(); render();
  });
}

// Number keys rate, arrows move: a rater doing thirty of these will find them.
document.addEventListener("keydown", (e) => {
  if (state.step < 0 || state.step >= items.length) return;
  if (e.target.tagName === "INPUT") return;
  if (e.key >= "1" && e.key <= "5") {
    document.querySelector(`.scale button[data-v="${e.key}"]`)?.click();
  } else if (e.key === "ArrowRight") {
    document.getElementById("next")?.click();
  } else if (e.key === "ArrowLeft") {
    document.getElementById("back")?.click();
  }
});

/* ---------- submission ---------- */
function payload() {
  const rows = items.map((it) => {
    const k = key(it.qi, it.clip.rank);
    return {
      query_index: it.qi,
      rank: it.clip.rank,        // the model's ordering: what analysis uses
      shown_position: it.shown,  // where this rater saw it
      clip_id: it.clip.clip_id,
      rating: state.ratings[k] ?? null,
      listened: !!state.played[k],
    };
  });
  rows.sort((a, b) => a.query_index - b.query_index || a.rank - b.rank);
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
  if (player) { try { player.stopVideo(); } catch {} }
  stepEl.textContent = "Finished";
  fillEl.style.width = "100%";
  const rated = Object.keys(state.ratings).length;
  const missed = Object.keys(state.skipped).length;
  bodyEl.innerHTML = `
    <div class="sheet slide">
      <p class="tick">Thank you</p>
      <h1>That is everything</h1>
      <p class="lede" id="msg">Sending your ${rated} rating${rated === 1 ? "" : "s"}…</p>
      ${missed ? `<p class="quiet">${missed} clip${missed === 1 ? " was" : "s were"} marked
        as not listenable. That is recorded as a gap, not as a low score.</p>` : ""}
      <p class="quiet">You can close this page once it says your ratings are saved.</p>
      <p class="status" id="status"></p>
    </div>`;
  footEl.innerHTML = `<div class="controls">
    <button class="ghost" id="backEnd">Back</button><span class="spacer"></span>
    <button class="ghost" id="dl">Download a copy</button>
    <button class="primary" id="retry" hidden>Try again</button></div>`;
  document.getElementById("dl").addEventListener("click", download);
  document.getElementById("retry").addEventListener("click", send);
  document.getElementById("backEnd").addEventListener("click", () => {
    direction = "back"; state.step--; save(); render();
  });
  send();
}

async function send() {
  const msg = document.getElementById("msg");
  const status = document.getElementById("status");
  const retry = document.getElementById("retry");
  status.className = "status"; status.textContent = "";
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.json();
    state.sent = true; save();
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
    bodyEl.innerHTML = `<div class="sheet"><h1>The study could not load</h1>
      <p class="lede">${esc(e.message)}. Refresh the page, or tell the researcher.</p></div>`;
    return;
  }
  restore();
  items = state.seed ? buildItems(state.seed) : buildItems(1);
  render();
})();

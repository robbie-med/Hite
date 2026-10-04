'use strict';
/* ============================================================
   Hite — ITE study tool for family medicine residents.
   Static, encrypted bank, offline-capable. All state lives in
   localStorage under the "ite." prefix and is never deleted by
   an app update: see migrate() for how older data is carried
   forward (and snapshotted first).
   ============================================================ */
const APP_VERSION = '8ef223cab4b8';
const $ = id => document.getElementById(id);
const PBKDF2_ITER = 310000;
const DAY = 86400000;
const now = () => Date.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (c, n) => n ? Math.round(c / n * 100) : null;
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDur = ms => { const s = Math.round(ms / 1000); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); };
const relDays = t => { const d = Math.round((t - now()) / DAY); if (d <= 0) return 'now'; if (d === 1) return 'tomorrow'; if (d < 14) return `in ${d} days`; if (d < 60) return `in ${Math.round(d / 7)} weeks`; return `in ${Math.round(d / 30)} months`; };
const agoDays = t => { const d = Math.floor((now() - t) / DAY); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const CONF_LABEL = ['Guess', 'Shaky', 'Confident'];
/* Icons: Material Symbols (default) or the emoji/glyph set, per the "Icons" setting.
   name → [Material Symbols ligature, emoji/glyph fallback] */
const ICONS = {
  study: ['psychology', '🧠'], quick: ['bolt', '⚡️'], timer: ['timer', '⏱'], missed: ['replay', '🔁'],
  flag: ['flag', '⚑'], full: ['school', '🎓'], install: ['add_to_home_screen', '📲'], backup: ['save', '💾'],
  warn: ['warning', '⚠'], note: ['edit_note', '📝'], check: ['check', '✓'], cross: ['close', '✗'],
  unseen: ['radio_button_unchecked', '○'], blank: ['remove', '–'], strike: ['block', '⊘'], dismiss: ['close', '✕'],
  guess: ['casino', '🎲'], fair: ['thumb_up', '🤔'], certain: ['verified', '💪'], event: ['event', '📅'],
  weak: ['trending_down', '📉'], goal: ['check', '✓'], image: ['image', '🖼️'], five: ['counter_5', '5️⃣'],
  t1: ['signal_cellular_alt_1_bar', '🟢'], t2: ['signal_cellular_alt_2_bar', '🟡'], t3: ['signal_cellular_alt', '🟠'], t4: ['local_fire_department', '🔥'],
  report: ['sms', '💬'],
};
const CONF_IC = ['guess', 'fair', 'certain'];
const useEmoji = () => settings.icons === 'emoji';
function ic(name, cls = '') {
  const [sym, emo] = ICONS[name] || [name, ''];
  return useEmoji() ? `<span class="ic emo ${cls}" aria-hidden="true">${emo}</span>` : `<span class="ic ms ${cls}" aria-hidden="true">${sym}</span>`;
}
const icEl = (name, cls) => { const t = document.createElement('template'); t.innerHTML = ic(name, cls); return t.content.firstChild; };
function paintIcons(root = document) { root.querySelectorAll('[data-ic]').forEach(e => { e.innerHTML = ic(e.dataset.ic); }); }
/* Public ABFM exam metadata (exam-meta.js): blueprint categories per item, items
   removed from scoring, raw→scaled tables, national means. Optional. */
const META = window.EXAM_META || { blueprint: {}, blueprintShort: {}, years: {} };
const BLUEPRINTS = Object.keys(META.blueprint);
const bpShort = b => (META.blueprintShort && META.blueprintShort[b]) || b;
const yearMeta = y => META.years[y] || null;

/* ---------------- storage ---------------- */
let storageWarned = false;
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('ite.' + k)); return v === null || v === undefined ? d : v; } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('ite.' + k, JSON.stringify(v)); return true; }
    catch (e) {
      if (!storageWarned) { storageWarned = true; toast('Storage is full. Back up now, then reset old history.', 'Back up', doBackup); }
      return false;
    }
  },
  del(k) { localStorage.removeItem('ite.' + k); },
};
const DEFAULTS = {
  theme: 'auto', textSize: 1, confidence: true, autoAdvance: false, dailyGoal: 20, examDate: '',
  secPerQ: 76, backupEvery: 7, smartSize: 20, showTimer: true, revealInBrowse: false,
  pgy: 0, includeDeleted: false, seed: '', icons: 'icons', skipEasy: 150, hideFlaggedYears: null,   // null = default by year
  confStyle: 'zones',   // 'zones': tap the guess/shaky/confident third of a choice · 'buttons': choose, then rate · 'off'
};
let settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
// Confidence style replaced the on/off "confidence" switch; keep "off" for anyone who had turned it off.
if (!settings.confStyle || !('confStyle' in (store.get('settings', {}) || {}))) settings.confStyle = settings.confidence === false ? 'off' : 'zones';
settings.confidence = settings.confStyle !== 'off';
// "Skip easy" briefly shipped off by default; turn it on unless the user has chosen for themselves.
if (!settings.skipEasySet) settings.skipEasy = 150;
// Per-year hiding of AI-flagged items: default 2022 and earlier until the user picks for themselves.
if (!settings.hideFlaggedSet) settings.hideFlaggedYears = null;
delete settings.showOutdatedOld;
function saveSettings() { store.set('settings', settings); applyAppearance(); }
function applyAppearance() {
  const root = document.documentElement;
  if (settings.theme === 'light' || settings.theme === 'dark') root.dataset.theme = settings.theme; else delete root.dataset.theme;
  root.style.setProperty('--fs', settings.textSize);
  root.dataset.icons = useEmoji() ? 'emoji' : 'icons';
  if (window.HiteTheme) HiteTheme.apply(settings.seed || HiteTheme.DEFAULT_SEED);
  paintIcons();
  requestAnimationFrame(() => { $('themeColor').content = getComputedStyle(document.body).backgroundColor; });
}
applyAppearance();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

/* Per-question stats live in one object keyed by "year-id":
   s attempts · c correct · lc last correct (1/0) · l last time · fa first-attempt ok
   iv interval (days) · ef ease · due next review · st correct streak · lcf last confidence
   h attempt log [[t, ok, conf, sec], …] · fl flagged · nt note                      */
const qstats = () => store.get('qstats', {});
const history = () => store.get('history', []);
let STATS = null;        // in-memory copy, written through
function stats() { if (!STATS) STATS = qstats(); return STATS; }
function persistStats() { return store.set('qstats', stats()); }
function entry(k) { const st = stats(); return st[k] || (st[k] = { s: 0, c: 0, lc: 0, l: 0 }); }
const attempted = s => s && s.s > 0;
/* Items ABFM removed from scoring (ambiguous / multiple correct answers) are kept
   out of fresh picks unless the user opts in; they stay reviewable. */
/* ABFM national difficulty (0 easiest … 1000 hardest) where exam-meta.js has it. "Skip easy"
   leaves those out of new-question picking; reviews of missed items and Full ITE keep them. */
const skippedEasy = q => settings.skipEasy >= 0 && q.df !== null && q.df <= settings.skipEasy;
/* AI currency review: items flagged "outdated" are hidden for the years in hideFlaggedYears
   (default: 2022 and earlier); later years show them with the label and reason. */
const OLDER_BEFORE = 2022;          // forms before this ship only their hardest items
const HIDE_FLAGGED_THROUGH = 2022;  // default: hide flagged items from this year and earlier
const hiddenAi = q => !!(q.ai && q.ai.s === 'outdated') && (settings.hideFlaggedYears || []).includes(q.y);
const pickable = q => (!q.x || settings.includeDeleted) && !skippedEasy(q) && !hiddenAi(q);
const diffWord = df => df >= 600 ? 'Hard' : df <= 150 ? 'Easy' : 'Medium';
const pickableKeys = () => QUESTIONS.filter(pickable).map(q => q.k);

/* ---------------- migration (never destructive) ---------------- */
function migrate() {
  const v = store.get('schema', 1);
  const oldQ = store.get('qstats', {}), oldH = store.get('history', []);
  if (v < 2 && (Object.keys(oldQ).length || oldH.length)) {
    // Keep an untouched copy of the pre-update data so nothing can be lost.
    store.set('snapshot.v1', { t: now(), label: 'before update to v2', qstats: oldQ, history: oldH });
  }
  // Backfill scheduling fields on any record that lacks them (v1 data, or a
  // v1 backup merged in later). Idempotent, so it is safe to run every boot.
  const t = now(); let changed = false;
  for (const k in oldQ) {
    const s = oldQ[k];
    if (s && s.due === undefined && s.s > 0) {
      s.ef = 2.5; s.st = s.lc ? 1 : 0; s.iv = s.lc ? 3 : 1;
      s.due = s.lc ? (s.l || t) + 3 * DAY : t;   // wrong answers come back right away
      changed = true;
    }
  }
  if (changed) store.set('qstats', oldQ);
  if (v < 2) store.set('schema', 2);
  STATS = null;
}

/* ---------------- UI primitives ---------------- */
function dialog({ title, msg, ok = 'OK', cancel = 'Cancel', danger = false, alertOnly = false }) {
  return new Promise(res => {
    $('dlgTitle').textContent = title;
    $('dlgMsg').textContent = msg;
    const okBtn = $('dlgOk'), cBtn = $('dlgCancel'), bd = $('dlgBackdrop');
    okBtn.textContent = ok;
    okBtn.classList.toggle('confirm-danger', danger);
    cBtn.classList.toggle('hidden', alertOnly);
    cBtn.textContent = cancel;
    bd.classList.add('on');
    const close = v => { bd.classList.remove('on'); okBtn.onclick = cBtn.onclick = bd.onclick = null; res(v); };
    okBtn.onclick = () => close(true);
    cBtn.onclick = () => close(false);
    bd.onclick = e => { if (e.target === bd) close(false); };
    setTimeout(() => okBtn.focus(), 30);
  });
}
const alertBox = (title, msg) => dialog({ title, msg, alertOnly: true });
let sheetOnClose = null;
function sheet(title, build) {
  const bd = $('sheetBackdrop'), body = $('sheetBody');
  $('sheetTitle').textContent = title;
  body.innerHTML = '';
  sheetOnClose = build(body) || null;
  bd.classList.add('on');
  bd.scrollTop = 0; $('sheetBox').scrollTop = 0;
  bd.onclick = e => { if (e.target === bd) closeSheet(); };
}
function closeSheet() {
  $('sheetBackdrop').classList.remove('on');
  if (sheetOnClose) { try { sheetOnClose(); } catch {} sheetOnClose = null; }
}
$('sheetClose').addEventListener('click', closeSheet);
let toastTimer = null;
function toast(msg, actionLabel, action) {
  const host = $('toastHost');
  host.innerHTML = '';
  const t = el('div', 'toast'); t.append(el('span', '', msg));
  if (actionLabel) { const b = el('button', '', actionLabel); b.onclick = () => { host.innerHTML = ''; action && action(); }; t.append(b); }
  host.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, actionLabel ? 7000 : 2800);
}

let QUESTIONS = [];          // decrypted bank
let BY_KEY = new Map();
let DOMAINS = [];
let YEARS = [];
let SEARCH_INDEX = [];
let dataBufPromise = null;
let quiz = null;             // active session state
let bankKey = null;          // AES key for data.enc, reused for images.enc
let imagesState = 'idle';    // idle → loading → ready | failed

/* ---------------- crypto + boot ---------------- */
async function fetchDataBuf() {
  if (!dataBufPromise) {
    dataBufPromise = fetch('data.enc').then(r => { if (!r.ok) throw new Error('fetch failed'); return r.arrayBuffer(); })
      .catch(e => { dataBufPromise = null; throw e; });
  }
  return dataBufPromise;
}
async function deriveKey(password, salt) {
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, mat, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function decryptBank(buf, key) {
  const iv = new Uint8Array(buf.slice(20, 32));
  const ct = new Uint8Array(buf.slice(32));
  const plainGz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  const stream = new Blob([plainGz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
/* Reasons this browser can't unlock at all, so they aren't reported as a wrong password. */
function unlockBlocker() {
  if (!window.isSecureContext || !(window.crypto && crypto.subtle)) return 'This page must be opened over https. Open https://hite.robbiemed.org instead.';
  if (typeof DecompressionStream === 'undefined') return 'This browser is too old to open Hite. Update it (iPhone: iOS 16.4 or later) and try again.';
  return '';
}
async function tryUnlock(key, remember, bank) {
  QUESTIONS = bank || await decryptBank(await fetchDataBuf(), key);   // throws on wrong password
  bankKey = key;
  if (remember) {
    const raw = await crypto.subtle.exportKey('raw', key);
    store.set('key', btoa(String.fromCharCode(...new Uint8Array(raw))));
  }
  enterApp();
  loadImages();
}
/* Clinical figures live in images.enc (same password and salt) so unlocking only
   waits for the text bank. Placeholders render until this resolves. */
async function loadImages() {
  if (!QUESTIONS.some(q => q.im) || imagesState === 'loading' || imagesState === 'ready') return;
  imagesState = 'loading';
  try {
    const r = await fetch('images.enc'); if (!r.ok) throw new Error('fetch failed');
    const map = await decryptBank(await r.arrayBuffer(), bankKey);
    for (const k in map) { const q = BY_KEY.get(k); if (q) q.i = map[k]; }
    imagesState = 'ready';
  } catch (e) { console.error(e); imagesState = 'failed'; }
  document.querySelectorAll('.q-figs[data-k]').forEach(f => f.replaceWith(figures(BY_KEY.get(f.dataset.k))));
}
async function boot() {
  migrate();
  registerSW();
  fetchDataBuf().catch(() => {});
  const savedKey = store.get('key', null);
  if (savedKey) {
    try {
      const raw = Uint8Array.from(atob(savedKey), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['decrypt']);
      await tryUnlock(key, false);
      return;
    } catch (e) {
      if (!String(e && e.message).includes('fetch')) store.del('key');
      else { $('loginErr').textContent = 'Could not load the question bank. Check your connection and reload.'; }
    }
  }
  $('view-login').classList.add('on');
  setTimeout(() => $('pw').focus(), 50);
}
$('pwEye').addEventListener('click', () => {
  const p = $('pw'); const show = p.type === 'password';
  p.type = show ? 'text' : 'password'; $('pwEye').innerHTML = `<span class="ms" aria-hidden="true">${show ? 'visibility_off' : 'visibility'}</span>`;
  $('pwEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('unlockBtn'), err = $('loginErr');
  btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
  try {
    const problem = unlockBlocker();
    if (problem) throw new Error(problem);
    const buf = await fetchDataBuf();
    const salt = new Uint8Array(buf.slice(4, 20));
    // Forgive a pasted trailing space or an auto-capitalised first letter.
    const typed = $('pw').value.trim(), tries = [...new Set([typed, typed.toLowerCase()])];
    let key = null, bank = null;
    for (const pw of tries) {
      const k = await deriveKey(pw, salt);
      try { bank = await decryptBank(buf, k); key = k; break; } catch (e) { if (e && e.name !== 'OperationError') throw e; }
    }
    if (!key) throw Object.assign(new Error('wrong password'), { wrongPassword: true });
    await tryUnlock(key, $('rememberMe').checked, bank);
  } catch (ex) {
    console.error(ex);
    const msg = String(ex && ex.message);
    err.textContent = ex && ex.wrongPassword ? 'Wrong password. Try again.'
      : msg.includes('fetch') ? 'Could not load question data. Are you online?'
      : unlockBlocker() || `Hite couldn't start on this browser (${msg}). Try updating it, or open the link in Safari or Chrome.`;
    $('loginBox').classList.add('shake');
    setTimeout(() => $('loginBox').classList.remove('shake'), 450);
    $('pw').select();
  }
  btn.disabled = false; btn.textContent = 'Unlock';
});

function enterApp() {
  BY_KEY = new Map(QUESTIONS.map(q => [q.k, q]));
  const rosterIdx = {};
  const diffIdx = {};
  for (const y in META.years) { const m = {}; for (const cat in META.years[y].roster) META.years[y].roster[cat].forEach(n => m[n] = cat); rosterIdx[y] = m; }
  for (const y in META.difficulty || {}) { const d = {}; for (const band in META.difficulty[y]) META.difficulty[y][band].forEach(n => d[n] = +band); diffIdx[y] = d; }
  QUESTIONS.forEach(q => {
    const ym = yearMeta(q.y);
    q.b = ym && rosterIdx[q.y] ? rosterIdx[q.y][q.n] || null : null;   // official blueprint category
    q.x = (ym ? ym.deleted[q.n] : (META.removed && META.removed[q.y] || {})[q.n]) || null;   // removed from ABFM scoring (reason)
    q.df = diffIdx[q.y] && q.n in diffIdx[q.y] ? diffIdx[q.y][q.n] : null;   // national difficulty band
  });
  YEARS = [...new Set(QUESTIONS.map(q => q.y))].sort();
  if (!Array.isArray(settings.hideFlaggedYears)) settings.hideFlaggedYears = YEARS.filter(y => y <= HIDE_FLAGGED_THROUGH);
  DOMAINS = [...new Set(QUESTIONS.map(q => q.d))].sort();
  SEARCH_INDEX = QUESTIONS.map(q => ({ k: q.k, t: (q.q + ' ' + Object.values(q.c).join(' ') + ' ' + q.e).toLowerCase() }));
  $('view-login').classList.remove('on');
  $('app').classList.remove('hidden');
  buildConfigUI();
  buildBrowseUI();
  buildMoreUI();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  showView('home');
  // Intro on first unlock, and once more for everyone whenever INTRO_VERSION is bumped.
  if (store.get('introVersion', 0) < INTRO_VERSION) showIntro();
}

/* ---------------- first-run intro ---------------- */
const INTRO_VERSION = 1;    // bump to show the intro again to existing users
let installPrompt = null;   // Chrome/Android "Install app" prompt, kept until the user asks for it
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
const isIOSDevice = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function introSlides() {
  const years = YEARS.length ? `${YEARS[0]}–${YEARS[YEARS.length - 1]}` : '';
  const install = isStandalone()
    ? `<p>You're already using Hite as an app. It works offline, and your device is less likely to clear your progress.</p>`
    : isIOSDevice()
      ? `<p>Put Hite on your home screen so it opens full-screen, works offline and keeps your progress safe. Safari can clear sites you haven't visited in a while; home-screen apps are protected.</p>
         <ol class="steps"><li>Tap <b>Share</b> <span class="ms" aria-hidden="true">ios_share</span> in Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Open Hite from the new icon</li></ol>`
      : `<p>Install Hite so it opens full-screen, works offline and keeps your progress safe.</p>
         ${installPrompt ? '<button class="btn sm" id="introInstall" type="button">Install app</button>' : '<ol class="steps"><li>Open your browser menu <span class="ms" aria-hidden="true">more_vert</span></li><li>Choose <b>Install app</b> or <b>Add to Home screen</b></li></ol>'}`;
  return [
    overall().attempts
      ? { ic: 'full', t: 'Welcome back', b: `<p>Hite has a new look and new ways to study: one-tap confidence, difficulty blocks, clinical images and ${QUESTIONS.length} questions (${years}). Your progress is all still here.</p><p class="muted">Swipe or tap Next for a 30-second tour.</p>` }
      : { ic: 'full', t: 'Welcome to Hite', b: `<p>${QUESTIONS.length} real ABFM In-Training Exam questions (${years}) with the official critiques. Your answers stay on this device.</p><p class="muted">Swipe or tap Next. This takes 30 seconds.</p>` },
    { ic: 'study', t: 'Pick how to study', b: `<ul class="ticks"><li><b>Study now</b> picks for you: reviews that are due, your weak areas, then new questions</li><li><b>Quick 5 / 10</b> for spare minutes, <b>Timed 40</b> for exam pace</li><li><b>By difficulty</b> blocks from ABFM's national ratings</li><li><b>Full ITE</b> takes a whole exam and gives a real scaled score</li></ul>` },
    { ic: 'missed', t: 'One tap: answer + how sure', b: `<p>Each answer is split into three. Tap the part that matches how sure you are:</p>
      <div class="intro-demo" aria-hidden="true"><div class="choice zoned demo"><div class="zones"><span class="zone z0"><span class="zl">Guess</span></span><span class="zone z1"><span class="zl">Shaky</span></span><span class="zone z2"><span class="zl">Confident</span></span></div><span class="letter">B</span><span class="txt">Start an SGLT2 inhibitor</span></div></div>
      <p>Guesses and confident misses come back sooner, so you review what you actually need. Prefer choosing first and rating after? Switch to <b>Buttons</b> in More.</p>
      <p class="muted">Questions most residents get right (ABFM national data) are skipped by default. Change it in More.</p>` },
    { ic: 'install', t: isStandalone() ? 'You\'re all set as an app' : 'Make it an app', b: install },
    { ic: 'backup', t: 'Back up now and then', b: `<p>Progress lives only on this device. A new phone, a cleared browser or a reinstall would lose it.</p><p><b>More → Back up now</b> saves a small file you can keep in Files, iCloud or email. Hite will remind you.</p>` },
    { ic: 'palette', t: 'Make it yours', b: `<p>Pick a colour. You can change it, the theme, icons and text size anytime in <b>More → Appearance</b>.</p><div id="introSwatches"></div>` },
  ];
}
function showIntro() {
  document.querySelector('.intro')?.remove();
  const slides = introSlides();
  let i = 0, x0 = null;
  const ov = el('div', 'intro'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Welcome to Hite');
  ov.innerHTML = `<button class="intro-skip" type="button">Skip</button>
    <div class="intro-track">${slides.map((sl, n) => `<section class="intro-slide" aria-hidden="${n ? 'true' : 'false'}"><div class="intro-ic">${ic(sl.ic)}</div><h2>${sl.t}</h2><div class="intro-body">${sl.b}</div></section>`).join('')}</div>
    <div class="intro-foot"><button class="btn sm danger intro-back" type="button" style="color:var(--md-primary)">Back</button>
      <div class="intro-dots" aria-hidden="true">${slides.map(() => '<i></i>').join('')}</div>
      <button class="btn sm intro-next" type="button">Next</button></div>`;
  const track = ov.querySelector('.intro-track'), dots = ov.querySelectorAll('.intro-dots i'), next = ov.querySelector('.intro-next'), back = ov.querySelector('.intro-back');
  const done = () => { store.set('introVersion', INTRO_VERSION); document.removeEventListener('keydown', onKey, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 220); };
  const go = n => {
    i = clamp(n, 0, slides.length - 1);
    track.style.transform = `translateX(${-100 * i}%)`;
    ov.querySelectorAll('.intro-slide').forEach((sl, n2) => sl.setAttribute('aria-hidden', n2 !== i));
    dots.forEach((d, n2) => d.classList.toggle('on', n2 === i));
    back.style.visibility = i ? 'visible' : 'hidden';
    next.textContent = i === slides.length - 1 ? 'Start studying' : 'Next';
  };
  const onKey = e => {
    if (e.key === 'Escape') done(); else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else return;
    e.preventDefault(); e.stopPropagation();
  };
  next.onclick = () => i === slides.length - 1 ? done() : go(i + 1);
  back.onclick = () => go(i - 1);
  ov.querySelector('.intro-skip').onclick = done;
  track.addEventListener('pointerdown', e => { x0 = e.clientX; });
  track.addEventListener('pointerup', e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); });
  ov.querySelector('#introInstall')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); const r = await installPrompt.userChoice.catch(() => null); installPrompt = null;
    if (r && r.outcome === 'accepted') toast('Installing Hite');
  });
  const sw = ov.querySelector('#introSwatches');
  const paintSwatches = () => { sw.innerHTML = ''; const p = swatchPicker(); p.addEventListener('click', () => setTimeout(paintSwatches, 0)); p.addEventListener('change', () => setTimeout(paintSwatches, 0)); sw.append(p); };
  paintSwatches();
  document.addEventListener('keydown', onKey, true);
  document.body.append(ov);
  go(0); next.focus();
}

/* ---------------- navigation ---------------- */
let currentView = 'home';
function showView(name) {
  if (quiz && name !== 'quiz' && name !== 'results') { saveSession(); stopTimer(); quiz = null; }
  currentView = name;
  document.querySelectorAll('#app .view').forEach(v => v.classList.remove('on'));
  $('view-' + name).classList.add('on');
  const inQuiz = name === 'quiz' || name === 'results';
  $('tabbar').classList.toggle('hidden', inQuiz);
  $('appbar').classList.toggle('hidden', name === 'quiz');
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === name));
  if (name === 'home') renderHome();
  if (name === 'stats') renderStats();
  if (name === 'browse') renderBrowse();
  if (name === 'more') renderMore();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => showView(b.dataset.nav)));
window.addEventListener('scroll', () => $('appbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

/* ---------------- derived stats ---------------- */
function overall() {
  const st = stats(); let seen = 0, attempts = 0, correct = 0;
  for (const k in st) { const s = st[k]; if (!attempted(s) || !BY_KEY.has(k)) continue; seen++; attempts += s.s; correct += s.c; }
  return { seen, attempts, correct };
}
const isDue = (s, t = now()) => attempted(s) && (s.due || 0) <= t;
function missedKeys() { const st = stats(); return Object.keys(st).filter(k => attempted(st[k]) && st[k].lc === 0 && BY_KEY.has(k)); }
function flaggedKeys() { const st = stats(); return Object.keys(st).filter(k => st[k].fl && BY_KEY.has(k)); }
function unseenKeys() { const st = stats(); return QUESTIONS.filter(q => pickable(q) && !attempted(st[q.k])).map(q => q.k); }
function dueKeys() {
  const st = stats(), t = now();
  return Object.keys(st).filter(k => BY_KEY.has(k) && isDue(st[k], t))
    .sort((a, b) => {
      // Confident misses (misconceptions) first, then most overdue.
      const pa = (st[a].lc === 0 && st[a].lcf === 2) ? 1 : 0, pb = (st[b].lc === 0 && st[b].lcf === 2) ? 1 : 0;
      return pb - pa || (st[a].due || 0) - (st[b].due || 0);
    });
}
function allAttempts() {   // flattened attempt log [{k, t, ok, conf, sec}], newest first
  const st = stats(), out = [];
  for (const k in st) { const h = st[k].h; if (!h) continue; for (const a of h) out.push({ k, t: a[0], ok: !!a[1], conf: a[2], sec: a[3] }); }
  return out.sort((a, b) => b.t - a.t);
}
function wilson(c, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = c / n, d = 1 + z * z / n, ctr = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(ctr - m) / d, (ctr + m) / d];
}
function domainStats() {
  const st = stats(), agg = {};
  DOMAINS.forEach(d => agg[d] = { d, c: 0, at: 0, seen: 0, total: 0 });
  QUESTIONS.forEach(q => { const a = agg[q.d]; a.total++; const s = st[q.k]; if (attempted(s)) { a.c += s.c; a.at += s.s; a.seen++; } });
  return Object.values(agg).map(a => { const [lo, hi] = wilson(a.c, a.at); return Object.assign(a, { pct: a.at ? a.c / a.at : null, lo, hi }); });
}
function blueprintStats() {
  const st = stats(), agg = {};
  BLUEPRINTS.forEach(b => agg[b] = { b, w: META.blueprint[b], c: 0, at: 0, seen: 0, total: 0 });
  QUESTIONS.forEach(q => { if (!q.b || !agg[q.b]) return; const a = agg[q.b]; a.total++; const s = st[q.k]; if (attempted(s)) { a.c += s.c; a.at += s.s; a.seen++; } });
  return Object.values(agg).map(a => { const [lo, hi] = wilson(a.c, a.at); return Object.assign(a, { pct: a.at ? a.c / a.at : null, lo, hi }); });
}
function weakDomains() {
  const ds = domainStats().filter(d => d.at >= 5).sort((a, b) => a.lo - b.lo);
  if (!ds.length) return [];
  const cut = Math.max(1, Math.ceil(ds.length / 3));
  return ds.slice(0, cut).filter(d => d.pct < 0.8).map(d => d.d);
}
function weakBlueprints() {
  const bs = blueprintStats().filter(b => b.at >= 8 && b.pct < 0.75).sort((a, b) => a.lo - b.lo);
  return bs.slice(0, 2).map(b => b.b);
}
/* Accuracy weighted by the ABFM blueprint percentages (only over areas with data). */
function blueprintWeighted() {
  const bs = blueprintStats().filter(b => b.at >= 5);
  const w = bs.reduce((s, b) => s + b.w, 0);
  return w ? { pct: bs.reduce((s, b) => s + b.pct * b.w, 0) / w, covered: w } : null;
}
/* Official raw→scaled lookup for a complete form; null when not applicable. */
function scaledFor(year, raw) {
  const ym = yearMeta(year); if (!ym) return null;
  const row = ym.conversion.find(([a, b]) => raw >= a && raw <= b);
  return row ? row[2] : null;
}
function activeDays() {
  const days = new Set(history().map(h => dayKey(h.t)));
  for (const a of allAttempts()) days.add(dayKey(a.t));
  return days;
}
function dayStreak() {
  const days = activeDays(); if (!days.size) return 0;
  let streak = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function todayCount() { const k = dayKey(now()); return allAttempts().filter(a => dayKey(a.t) === k).length; }
function recentAccuracy(days) { const t = now() - days * DAY; const a = allAttempts().filter(x => x.t >= t); return { n: a.length, c: a.filter(x => x.ok).length }; }
function firstTryAccuracy() { const st = stats(); let n = 0, c = 0; for (const k in st) { if (st[k].fa !== undefined && BY_KEY.has(k)) { n++; c += st[k].fa ? 1 : 0; } } return { n, c }; }
function retention(minDays = 7) {
  const st = stats(); let n = 0, c = 0;
  for (const k in st) {
    const h = st[k].h; if (!h || h.length < 2) continue;
    for (let i = 1; i < h.length; i++) if (h[i][0] - h[i - 1][0] >= minDays * DAY) { n++; if (h[i][1]) c++; }
  }
  return { n, c };
}
function calibration() {
  const r = [0, 1, 2].map(() => ({ n: 0, c: 0 }));
  for (const a of allAttempts()) if (a.conf >= 0 && a.conf <= 2) { r[a.conf].n++; if (a.ok) r[a.conf].c++; }
  return r;
}

/* ---------------- spaced repetition (SM-2 style) ---------------- */
function schedule(s, ok, conf, t) {
  s.ef = s.ef || 2.5;
  if (ok) {
    s.st = (s.st || 0) + 1;
    let iv = s.iv > 0 && s.lc ? s.iv * s.ef : (s.st <= 1 ? 2 : 4);
    if (conf === 0) { iv = Math.min(iv, 2); s.ef = Math.max(1.3, s.ef - 0.05); }   // a lucky guess is not learned yet
    if (conf === 2) s.ef = Math.min(3.0, s.ef + 0.05);
    s.iv = clamp(Math.round(iv), 1, 180);
  } else {
    s.st = 0; s.iv = 1;
    s.ef = Math.max(1.3, s.ef - (conf === 2 ? 0.3 : 0.2));                        // confident miss = misconception
  }
  s.due = t + s.iv * DAY;
}
function recordAttempt(k, pick, ok, conf, sec) {
  const t = now(), s = entry(k);
  if (!attempted(s)) s.fa = ok ? 1 : 0;
  s.s++; if (ok) s.c++;
  schedule(s, ok, conf, t);
  s.lc = ok ? 1 : 0; s.l = t; s.lcf = conf;
  (s.h = s.h || []).push([t, ok ? 1 : 0, conf, Math.round(sec)]);
  if (s.h.length > 30) s.h.splice(0, s.h.length - 30);
  persistStats();
  store.set('sinceBackup', store.get('sinceBackup', 0) + 1);
  return s;
}

/* ---------------- session composition ---------------- */
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function smartPlan(n = settings.smartSize) {
  const st = stats();
  const due = dueKeys().slice(0, Math.ceil(n / 2));
  const taken = new Set(due);
  const weak = new Set(weakDomains()), weakBp = new Set(weakBlueprints());
  const unseen = shuffle(unseenKeys().filter(k => !taken.has(k)));
  const weakUnseen = unseen.filter(k => { const q = BY_KEY.get(k); return weak.has(q.d) || weakBp.has(q.b); });
  const rest = n - due.length;
  const w = weakUnseen.slice(0, Math.ceil(rest * 0.6));
  w.forEach(k => taken.add(k));
  const fresh = unseen.filter(k => !taken.has(k)).slice(0, rest - w.length);
  fresh.forEach(k => taken.add(k));
  let keys = [...due, ...w, ...fresh];
  if (keys.length < n) {   // bank exhausted: least-recently-seen fill
    const fill = Object.keys(st).filter(k => BY_KEY.has(k) && attempted(st[k]) && !taken.has(k)).sort((a, b) => (st[a].l || 0) - (st[b].l || 0)).slice(0, n - keys.length);
    keys = keys.concat(fill);
  }
  return { keys: shuffle(keys), due: due.length, weak: w.length, fresh: fresh.length };
}
function describePlan(p) {
  const parts = [];
  if (p.due) parts.push(`${p.due} due`);
  if (p.weak) parts.push(`${p.weak} weak-area`);
  if (p.fresh) parts.push(`${p.fresh} new`);
  const other = p.keys.length - p.due - p.weak - p.fresh;
  if (other > 0) parts.push(`${other} refresh`);
  return parts.length ? parts.join(' · ') + ' · interleaved' : 'Mixed review';
}

/* ---------------- home ---------------- */
let builderCfg = { mode: 'study', years: [], cats: [], bp: [], pool: 'all' };
function buildConfigUI() {
  const yc = $('yearChips'); yc.innerHTML = '';
  const mk = (txt, val, on) => { const c = el('button', 'chip' + (on ? ' on' : ''), txt); c.dataset.val = val; return c; };
  yc.append(mk('All', 'all', true));
  YEARS.forEach(y => yc.append(mk(String(y), String(y), false)));
  yc.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    const all = yc.querySelector('[data-val=all]');
    if (chip.dataset.val === 'all') { yc.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); chip.classList.add('on'); }
    else { all.classList.remove('on'); chip.classList.toggle('on'); if (!yc.querySelector('.chip.on')) all.classList.add('on'); }
    builderCfg.years = [...yc.querySelectorAll('.chip.on')].map(c => c.dataset.val).filter(v => v !== 'all').map(Number);
    updateMatchCount();
  });
  const counts = {}; QUESTIONS.forEach(q => counts[q.d] = (counts[q.d] || 0) + 1);
  const cc = $('catChips'); cc.innerHTML = '';
  DOMAINS.forEach(d => { const c = mk(d, d, false); c.append(el('span', 'n', counts[d])); cc.append(c); });
  cc.addEventListener('click', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    chip.classList.toggle('on');
    builderCfg.cats = [...cc.querySelectorAll('.chip.on')].map(c => c.dataset.val);
    updateMatchCount();
  });
  const bc = $('bpChips'); bc.innerHTML = '';
  if (BLUEPRINTS.length && QUESTIONS.some(q => q.b)) {
    BLUEPRINTS.forEach(b => { const c = mk(bpShort(b), b, false); c.title = b; c.append(el('span', 'n', META.blueprint[b] + '%')); bc.append(c); });
    bc.addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      chip.classList.toggle('on');
      builderCfg.bp = [...bc.querySelectorAll('.chip.on')].map(c => c.dataset.val);
      updateMatchCount();
    });
  } else bc.closest('.field').classList.add('hidden');
  $('catClear').addEventListener('click', e => { e.preventDefault(); cc.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); builderCfg.cats = []; updateMatchCount(); });
  [['poolSeg', 'pool'], ['modeSeg', 'mode']].forEach(([id, key]) => $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    builderCfg[key] = b.dataset[key]; updateMatchCount();
  }));
  $('countSelect').addEventListener('change', updateMatchCount);
  $('builder').addEventListener('toggle', () => { if ($('builder').open) updateMatchCount(); });
}
function builderKeys(cfg = builderCfg) {
  const st = stats(), t = now(), weak = new Set(weakDomains());
  return QUESTIONS
    .filter(q => !cfg.years.length || cfg.years.includes(q.y))
    .filter(q => !cfg.cats.length || cfg.cats.includes(q.d))
    .filter(q => !cfg.bp || !cfg.bp.length || cfg.bp.includes(q.b))
    .filter(q => cfg.pool === 'missed' || cfg.pool === 'flagged' || cfg.pool === 'due' || pickable(q))
    .filter(q => {
      const s = st[q.k];
      switch (cfg.pool) {
        case 'unseen': return !attempted(s);
        case 'due': return isDue(s, t);
        case 'missed': return attempted(s) && s.lc === 0;
        case 'flagged': return s && s.fl;
        case 'weak': return weak.size ? weak.has(q.d) : true;
        case 'hard': return q.df !== null && q.df >= 500;
        default: return true;
      }
    }).map(q => q.k);
}
function updateMatchCount() {
  const n = builderKeys().length, want = +$('countSelect').value;
  const take = want ? Math.min(want, n) : n;
  $('matchCount').textContent = n ? `${n} questions match · session of ${take}${builderCfg.mode === 'exam' ? ` · ${Math.round(take * settings.secPerQ / 60)} min` : ''}` : 'Nothing matches those filters yet.';
  $('startCustom').disabled = !n;
}
function builderLabel(cfg) {
  const parts = [];
  parts.push(cfg.cats.length ? (cfg.cats.length > 2 ? `${cfg.cats.length} categories` : cfg.cats.join(' + ')) : 'All categories');
  if (cfg.bp && cfg.bp.length) parts.push(cfg.bp.map(bpShort).join(' + '));
  parts.push(cfg.years.length ? cfg.years.join('/') : 'all years');
  if (cfg.pool !== 'all') parts.push({ unseen: 'unseen', due: 'due', missed: 'missed', flagged: 'flagged', weak: 'weak areas', hard: 'hardest' }[cfg.pool]);
  return parts.join(' · ');
}
$('startCustom').addEventListener('click', () => {
  const cfg = JSON.parse(JSON.stringify(builderCfg)), n = +$('countSelect').value;
  let keys = shuffle(builderKeys(cfg)); if (n) keys = keys.slice(0, n);
  if (!keys.length) return;
  startQuiz(keys, builderLabel(cfg), cfg.mode, { type: 'custom', cfg, n });
});

function renderHome() {
  const o = overall(), st = stats();
  const h = new Date().getHours();
  $('greeting').textContent = h < 5 ? 'Night shift?' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const due = dueKeys().length, missed = missedKeys().length, flagged = flaggedKeys().length;
  const weak = domainStats().filter(d => d.at >= 5).sort((a, b) => a.lo - b.lo)[0];
  const subs = [];
  if (due) subs.push(`${due} due for review`);
  if (weak && weak.pct < 0.75) subs.push(`weakest: ${weak.d} ${Math.round(weak.pct * 100)}%`);
  if (!subs.length) subs.push(`${QUESTIONS.length - o.seen} of ${QUESTIONS.length} not yet seen`);
  const done = todayCount(), goal = settings.dailyGoal || 20;
  subs.unshift(done >= goal ? `Daily goal met (${done})` : `${done} of ${goal} today`);
  $('heroSub').textContent = subs.join(' · ');
  $('tDue').textContent = due; $('tileDue').classList.toggle('hot', due > 0);
  $('tAccuracy').textContent = o.attempts ? pct(o.correct, o.attempts) + '%' : '–';
  $('tSeen').textContent = pct(o.seen, QUESTIONS.length) + '%';
  $('tStreak').textContent = dayStreak();
  renderGoalRing();
  const plan = smartPlan();
  $('smartSub').textContent = plan.keys.length ? `${plan.keys.length} questions · ${describePlan(plan)}` : 'Nothing to study yet';
  $('smartBtn').disabled = !plan.keys.length;
  $('missedCount').textContent = missed ? `${missed} to review` : 'none yet';
  $('quickMissed').disabled = !missed;
  $('flaggedCount').textContent = flagged ? `${flagged} saved` : 'none yet';
  $('quickFlagged').disabled = !flagged;
  $('timedSub').textContent = `${Math.round(40 * settings.secPerQ / 60)} min · exam pace`;
  const sess = store.get('session', null);
  $('resumeCard').classList.toggle('hidden', !sess);
  if (sess) {
    const answered = Array.isArray(sess.ans) ? sess.ans.length : Object.keys(sess.ans || {}).length;
    $('resumeSub').textContent = `${sess.label} · ${answered} of ${sess.keys.length} answered${sess.mode === 'exam' ? ' · timed' : ''}`;
  }
  renderHomeCards(o, weak);
  renderTiers();
  updateBadges(due);
}
function renderGoalRing() {
  const done = todayCount(), goal = settings.dailyGoal || 20, p = clamp(done / goal, 0, 1);
  /* M3 circular progress: active arc, a small gap, then the track. Only the count sits inside. */
  const r = 24, C = 2 * Math.PI * r, gap = p > 0 && p < 1 ? 8 : 0, arc = C * p, rest = Math.max(0, C - arc - 2 * gap);
  const ring = $('goalRing');
  ring.classList.toggle('done', p >= 1);
  ring.title = `${done} of ${goal} questions today`;
  ring.innerHTML = `<svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
    ${p < 1 ? `<circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--md-secondary-container)" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${rest.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-(arc + gap)).toFixed(1)}"/>` : ''}
    ${p > 0 ? `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${p >= 1 ? 'var(--md-good)' : 'var(--md-primary)'}" stroke-width="4" stroke-linecap="round"
      stroke-dasharray="${arc.toFixed(1)} ${C.toFixed(1)}"/>` : ''}</svg>
    <div class="val">${p >= 1 ? '<span class="ms" aria-hidden="true">check</span>' : done}</div>`;
}
function renderHomeCards(o, weak) {
  const box = $('homeCards'); box.innerHTML = '';
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isIOS && !standalone && !store.get('tipInstallDismissed', false)) {
    const c = el('div', 'card tinted tip-card'); c.style.marginTop = '12px';
    c.innerHTML = `${ic('install', 'ico')}<div><h3>Add to Home Screen</h3><div class="sub">Tap <b>Share</b> → <b>Add to Home Screen</b>. You get a full-screen app, and Safari won't clear your progress after a week away (it can for regular tabs).</div></div><button class="x icon-btn" aria-label="Dismiss"><span class="ms" aria-hidden="true">close</span></button>`;
    c.querySelector('.x').onclick = () => { store.set('tipInstallDismissed', true); c.remove(); };
    box.append(c);
  }
  if (backupDue()) {
    const c = el('div', 'card warn tip-card'); c.style.marginTop = '12px';
    const lb = store.get('lastBackup', null);
    c.innerHTML = `${ic('backup', 'ico')}<div><h3>Back up your progress</h3><div class="sub">${lb ? `Last backup ${agoDays(lb)}` : 'Never backed up'} · ${store.get('sinceBackup', 0)} answers since. Progress is stored only on this device.</div><div class="row" style="margin-top:10px"><button class="btn sm" id="hbBackup">Back up now</button><button class="btn sm danger" style="color:inherit" id="hbLater">Remind me later</button></div></div>`;
    c.querySelector('#hbBackup').onclick = () => doBackup().then(ok => { if (ok) renderHome(); });
    c.querySelector('#hbLater').onclick = () => { store.set('backupSnoozed', now()); c.remove(); };
    box.append(c);
  }
  if (settings.examDate) {
    const days = Math.ceil((new Date(settings.examDate + 'T09:00') - now()) / DAY);
    if (days >= 0) {
      const unseen = QUESTIONS.length - o.seen, perDay = days ? Math.ceil(unseen / days) : unseen;
      const c = el('div', 'card'); c.style.marginTop = '12px';
      c.innerHTML = `<div class="row between"><div><h3>ITE in ${days} day${days === 1 ? '' : 's'}</h3><div class="sub">${unseen ? `${unseen} unseen · about ${perDay}/day to see everything once` : 'You have seen every question at least once'}${todayCount() < (settings.dailyGoal || 20) ? ` · ${(settings.dailyGoal || 20) - todayCount()} to go today` : ' · goal met today'}</div></div></div>`;
      box.append(c);
    }
  }
  if (weak && weak.pct < 0.75) {
    const c = el('div', 'card'); c.style.marginTop = '12px';
    c.innerHTML = `<div class="row between"><div><h3>Weakest area: ${esc(weak.d)}</h3><div class="sub">${Math.round(weak.pct * 100)}% on ${weak.at} answers · ${weak.seen}/${weak.total} seen</div></div><button class="btn sm" id="hwGo">Practice</button></div>`;
    c.querySelector('#hwGo').onclick = () => startDomain(weak.d);
    box.append(c);
  }
}
/* Difficulty blocks: 10 questions from one band of ABFM's national difficulty, unseen first. */
const TIERS = [
  { id: 'medium', name: 'Medium', lo: 300, hi: 450, ic: 't1' },
  { id: 'hard', name: 'Hard', lo: 500, hi: 650, ic: 't2' },
  { id: 'vhard', name: 'Very hard', lo: 700, hi: 850, ic: 't3' },
  { id: 'hardest', name: 'Hardest', lo: 900, hi: 1000, ic: 't4' },
];
const tierPool = t => QUESTIONS.filter(q => q.df !== null && q.df >= t.lo && q.df <= t.hi && (!q.x || settings.includeDeleted) && !hiddenAi(q));
function tierKeys(t, n = 10) {
  const st = stats(), pool = tierPool(t);
  const unseen = shuffle(pool.filter(q => !attempted(st[q.k]))), seen = shuffle(pool.filter(q => attempted(st[q.k])));
  return [...unseen, ...seen].slice(0, n).map(q => q.k);
}
function startTier(id) { const t = TIERS.find(x => x.id === id); const k = tierKeys(t); if (k.length) startQuiz(k, `${t.name} ${k.length}`, 'study', { type: 'tier', id }); }
function renderTiers() {
  const row = $('tierRow'), any = QUESTIONS.some(q => q.df !== null);
  $('tierBox').classList.toggle('hidden', !any); if (!any) return;
  row.innerHTML = '';
  const st = stats();
  TIERS.forEach(t => {
    const pool = tierPool(t), unseen = pool.filter(q => !attempted(st[q.k])).length;
    const b = el('button', 'quick-btn'); b.disabled = !pool.length;
    b.innerHTML = `<div class="big">${ic(t.ic)}</div><div class="t">${t.name} 10</div><div class="s">rated ${t.lo}–${t.hi} · ${pool.length} questions${pool.length ? ` · ${unseen} unseen` : ''}</div>`;
    b.onclick = () => startTier(t.id);
    row.append(b);
  });
}
function startDomain(d) {
  const st = stats();
  const pool = QUESTIONS.filter(q => (q.d === d || q.b === d) && pickable(q));
  const unseen = pool.filter(q => !attempted(st[q.k])), missed = pool.filter(q => attempted(st[q.k]) && st[q.k].lc === 0);
  let keys = shuffle([...missed.map(q => q.k), ...unseen.map(q => q.k)]).slice(0, 20);
  if (keys.length < 10) keys = shuffle(pool.map(q => q.k)).slice(0, 20);
  startQuiz(keys, d, 'study', { type: 'domain', d });
}
function updateBadges(due) {
  document.querySelectorAll('[data-nav=home]').forEach(b => {
    b.querySelector('.badge')?.remove();
    if (due > 0) b.append(Object.assign(el('span', 'badge', due > 99 ? '99+' : due)));
  });
}
$('smartBtn').addEventListener('click', () => { const p = smartPlan(); if (p.keys.length) startQuiz(p.keys, 'Smart session', 'study', { type: 'smart' }); });
document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
  const n = +b.dataset.quick;
  startQuiz(shuffle(pickableKeys()).slice(0, n), `Quick ${n}`, 'study', { type: 'quick', n });
}));
$('quickTimed').addEventListener('click', () => startQuiz(shuffle(pickableKeys()).slice(0, 40), 'Timed block', 'exam', { type: 'timed', n: 40 }));
$('quickFull').addEventListener('click', openFullIte);
function fullFormKeys(y) { return QUESTIONS.filter(q => q.y === y).sort((a, b) => a.n - b.n).map(q => q.k); }
function openFullIte() {
  sheet('Full ITE simulation', body => {
    body.append(Object.assign(el('p', 'sub'), { textContent: `Take a whole ITE form in order, timed at ${settings.secPerQ} s/question (${Math.round(META.iteQuestions * settings.secPerQ / 60)} min), no feedback until you submit. Forms with ABFM scoring data give an official scaled score (200–800) and national PGY comparisons.` }));
    const st = stats();
    YEARS.filter(y => fullFormKeys(y).length >= 150).forEach(y => {   // older forms ship only their hardest items
      const keys = fullFormKeys(y), ym = yearMeta(y), seen = keys.filter(k => attempted(st[k])).length;
      const c = el('div', 'card'); c.style.marginBottom = '10px';
      c.innerHTML = `<div class="row between"><div><h3>ITE ${y}</h3><div class="sub">${keys.length} questions · ${seen} already seen${ym ? ' · <b>scaled score available</b>' : ' · percent only'}</div></div><button class="btn sm">Start</button></div>`;
      c.querySelector('button').onclick = async () => {
        closeSheet();
        if (seen > keys.length / 3 && !(await dialog({ title: 'Seen questions', msg: `You have already seen ${seen} of these ${keys.length} questions, so the score will run high. Start anyway?`, ok: 'Start' }))) return;
        startQuiz(keys, `Full ITE ${y}`, 'exam', { type: 'full', y });
      };
      body.append(c);
    });
  });
}
$('quickMissed').addEventListener('click', () => { const k = shuffle(missedKeys()); if (k.length) startQuiz(k.slice(0, 40), 'Missed review', 'study', { type: 'missed' }); });
$('quickFlagged').addEventListener('click', () => { const k = shuffle(flaggedKeys()); if (k.length) startQuiz(k, 'Flagged review', 'study', { type: 'flagged' }); });
$('resumeBtn').addEventListener('click', resumeSession);
$('discardBtn').addEventListener('click', async () => {
  if (await dialog({ title: 'Discard this session?', msg: 'Answers you already gave are kept in your stats; only the unfinished session is dropped.', ok: 'Discard', danger: true })) { store.del('session'); renderHome(); }
});

/* ---------------- quiz engine ---------------- */
function startQuiz(keys, label, mode = 'study', src = null) {
  if (!keys.length) return;
  quiz = { v: 2, keys, idx: 0, ans: {}, flags: {}, strikes: {}, time: {}, label, mode, t: now(), src, sel: null, acc: 0, t0: now() };
  if (mode === 'exam') quiz.limitMs = keys.length * settings.secPerQ * 1000;
  saveSession();
  showView('quiz');
  renderQuestion();
}
function resumeSession() {
  const s = store.get('session', null); if (!s) return;
  const keys = s.keys.filter(k => BY_KEY.has(k));
  if (!keys.length) { store.del('session'); renderHome(); return; }
  if (Array.isArray(s.ans)) {   // legacy v1 session
    const ans = {}; s.ans.forEach(a => ans[a.k] = { pick: a.pick, ok: a.ok, conf: -1 });
    quiz = { v: 2, keys, idx: Math.min(s.idx, keys.length - 1), ans, flags: {}, strikes: {}, time: {}, label: s.label, mode: 'study', t: s.t, src: null, sel: null, acc: 0, t0: now() };
  } else {
    quiz = Object.assign({}, s, { keys, idx: Math.min(s.idx, keys.length - 1), sel: null, t0: now() });
  }
  showView('quiz');
  renderQuestion();
}
function saveSession() {
  if (!quiz) return;
  const finishedStudy = quiz.mode === 'study' && quiz.idx >= quiz.keys.length;
  if (finishedStudy) { store.del('session'); return; }
  const snap = Object.assign({}, quiz, { acc: elapsed(), t0: undefined, sel: undefined });
  store.set('session', snap);
}
const elapsed = () => quiz ? quiz.acc + (now() - quiz.t0) : 0;
const curKey = () => quiz.keys[quiz.idx];
const curQ = () => BY_KEY.get(curKey());
const answeredCount = () => Object.values(quiz.ans).filter(a => a.pick).length;
let timerId = null, autoAdvanceId = null;
function stopTimer() { clearInterval(timerId); timerId = null; clearTimeout(autoAdvanceId); autoAdvanceId = null; }
function tickTimer() {
  if (!quiz || quiz.mode !== 'exam') return;
  const left = quiz.limitMs - elapsed();
  const sc = $('quizScore');
  sc.className = 'quiz-score timer' + (left < 5 * 60000 ? ' low' : '');
  sc.textContent = settings.showTimer ? fmtClock(left) : `${answeredCount()}/${quiz.keys.length}`;
  if (left <= 0) { stopTimer(); toast("Time's up — block submitted."); finishQuiz(); }
}

function renderStem(container, text) {
  container.innerHTML = '';
  let labs = null;
  text.split('\n').forEach(line => {
    const i = line.indexOf('…');
    const isLab = i > 0 && i < line.length - 1 && line.length - i < 90;
    if (isLab) {
      if (!labs) { labs = el('div', 'labs'); container.append(labs); }
      const row = el('div', 'lr'); row.append(el('span', 'll', line.slice(0, i).trim()), el('span', 'lv', line.slice(i + 1).trim()));
      labs.append(row);
    } else { labs = null; if (line.trim()) container.append(el('p', '', line)); }
  });
}
/* Taps on answers must never come from scrolling: ignore the click if the finger moved,
   if the page scrolled during the press, or if the press landed while a fling was still
   moving (that tap only stops the scroll). Keyboard activation (detail 0) always counts. */
let lastScrollAt = 0;
window.addEventListener('scroll', () => { lastScrollAt = now(); }, { passive: true });
function onTap(node, fn) {
  let sx = 0, sy = 0, st = 0, scrolledBefore = false;
  node.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; st = now(); scrolledBefore = st - lastScrollAt < 120; });
  node.addEventListener('click', e => {
    if (e.detail !== 0) {
      const moved = Math.hypot(e.clientX - sx, e.clientY - sy) > 10;
      if (moved || scrolledBefore || lastScrollAt >= st) { e.preventDefault(); return; }
    }
    fn(e);
  });
}
function figures(q) {
  const box = el('div', 'q-figs'); box.dataset.k = q.k;
  if (q.i && q.i.length) {
    q.i.forEach((src, j) => {
      const b = el('button', 'q-fig'); b.setAttribute('aria-label', `Enlarge figure ${j + 1} of ${q.i.length}`);
      const img = el('img'); img.src = src; img.alt = `Figure ${j + 1} for ${q.y} item ${q.n}`; img.decoding = 'async';
      b.append(img); b.onclick = () => lightbox(q, j);
      box.append(b);
    });
  } else {
    const ph = el('div', 'q-fig-ph');
    ph.innerHTML = imagesState === 'failed'
      ? `${ic('warn')}<span>Image couldn't load. <button class="link-btn" type="button">Try again</button></span>`
      : `<span class="spin" aria-hidden="true"></span><span>Loading image…</span>`;
    ph.querySelector('button')?.addEventListener('click', () => { imagesState = 'idle'; loadImages(); });
    box.append(ph);
  }
  return box;
}
const hasFigures = q => !!(q.im || (q.i && q.i.length));
function lightbox(q, j) {
  const lb = el('div', 'lightbox'); lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Figure');
  const img = el('img'); img.alt = `Figure for ${q.y} item ${q.n}`;
  const close = el('button', 'icon-btn lb-close'); close.innerHTML = '<span class="ms" aria-hidden="true">close</span>'; close.setAttribute('aria-label', 'Close');
  const count = el('div', 'lb-count');
  const show = i => { j = (i + q.i.length) % q.i.length; img.src = q.i[j]; count.textContent = q.i.length > 1 ? `${j + 1} / ${q.i.length}` : ''; };
  const done = () => { lb.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape') done(); else if (e.key === 'ArrowRight') show(j + 1); else if (e.key === 'ArrowLeft') show(j - 1); else return;
    e.preventDefault(); e.stopPropagation();
  };
  lb.append(img, close, count);
  if (q.i.length > 1) {
    [['chevron_left', -1, 'Previous'], ['chevron_right', 1, 'Next']].forEach(([n, d, l]) => {
      const b = el('button', 'icon-btn lb-nav ' + (d < 0 ? 'prev' : 'next')); b.innerHTML = `<span class="ms" aria-hidden="true">${n}</span>`; b.setAttribute('aria-label', l + ' figure');
      b.onclick = e => { e.stopPropagation(); show(j + d); }; lb.append(b);
    });
  }
  lb.onclick = e => { if (e.target === lb || e.target === close || close.contains(e.target)) done(); };
  document.addEventListener('keydown', onKey, true);
  show(j); document.body.append(lb); close.focus();
}
/* ---------------- report a question ----------------
   Opens a prefilled email with the item reference; the person adds what is wrong and
   sends. Only the reference is sent, never the item. (An SMS route exists in sms-bridge/
   if a report number is ever wanted.) */
const REPORT_EMAIL = 'ite_problem@robbiemed.org';
function reportText(q, a) {
  const bits = [`Hite ${q.y} #${q.n}`, q.d];
  if (q.b) bits.push(bpShort(q.b));
  if (a && a.pick) bits.push(`I chose ${a.pick}, key ${q.a}`);
  else if (a && a.revealed) bits.push(`key ${q.a}`);
  bits.push('v' + APP_VERSION.slice(0, 6));
  return bits.join(' · ') + '\nProblem: ';
}
const reportLink = (q, a) => `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(`Hite ${q.y} #${q.n}`)}&body=${encodeURIComponent(reportText(q, a))}`;
function reportQuestion(q, a) { location.href = reportLink(q, a); }
/* AI currency flag, ABFM errata, and the older-form note, shown with the explanation. */
function sourceNotes(q) {
  const out = [];
  if (q.ai) {
    const n = el('div', 'ai-note ' + q.ai.s);
    n.innerHTML = `<div class="h">${ic('warn')}<b>${{ outdated: 'Flagged by AI as likely outdated', error: 'AI note: error in the explanation' }[q.ai.s] || 'AI note: the explanation is dated'}</b></div><div class="b"></div><div class="f">AI review, Oct 2026. Judged against what the ITE currently expects; verify before relying on it.</div>`;
    n.querySelector('.b').textContent = q.ai.w;
    out.push(n);
  }
  if (q.er) { const n = el('div', 'ai-note errata'); n.innerHTML = `<div class="h">${ic('note')}<b>Errata</b></div><div class="b"></div>`; n.querySelector('.b').textContent = q.er; out.push(n); }
  if (q.y < OLDER_BEFORE) out.push(el('div', 'next-due', `From the ${q.y} ITE: only its hardest questions are included, each reviewed for currency. Guidelines may have moved since.`));
  return out;
}
function renderQuestion() {
  stopTimer();
  const q = curQ(), k = q.k, s = stats()[k], a = quiz.ans[k];
  quiz.sel = null; quiz.qStart = now();
  const pos = $('quizPos');
  pos.innerHTML = `${quiz.idx + 1} / ${quiz.keys.length}<small>${quiz.mode === 'exam' ? 'tap for navigator' : esc(quiz.label)}</small>`;
  $('quizBar').style.width = ((quiz.mode === 'exam' ? answeredCount() : quiz.idx) / quiz.keys.length * 100) + '%';
  if (quiz.mode === 'exam') { tickTimer(); timerId = setInterval(tickTimer, 1000); } else renderScoreChip();
  const meta = $('qMeta'); meta.innerHTML = '';
  [q.y, q.d, '#' + q.n].forEach(t => meta.append(el('span', '', t)));
  if (q.b) { const b = el('span', 'bp', bpShort(q.b)); b.title = `ABFM blueprint: ${q.b} (${META.blueprint[q.b]}% of the exam)`; meta.append(b); }
  if (q.x && quiz.mode === 'study') { const w = el('span', 'warn'); w.innerHTML = ic('warn') + 'Removed from scoring'; w.title = `ABFM deleted this item from the ${q.y} ITE scoring (${q.x} reason)`; meta.append(w); }
  if (q.ai && q.ai.s === 'outdated' && quiz.mode === 'study') { const w = el('span', 'warn'); w.innerHTML = ic('warn') + 'Flagged by AI'; meta.append(w); }
  if (quiz.mode === 'study' && attempted(s)) { const sb = el('span', 'seen-before'); sb.innerHTML = `Seen ×${s.s} · last ${ic(s.lc ? 'check' : 'cross')}`; meta.append(sb); }
  const tools = el('div', 'tools');
  const flag = el('button', 'icon-btn' + (isFlagged(k) ? ' on' : '')); flag.innerHTML = ic('flag'); flag.setAttribute('aria-label', 'Flag question'); flag.title = 'Flag for review (F)';
  flag.onclick = () => { toggleFlag(k); flag.classList.toggle('on', isFlagged(k)); };
  const rep = el('button', 'icon-btn report'); rep.innerHTML = ic('report'); rep.setAttribute('aria-label', 'Report a problem with this question'); rep.title = 'Report a problem';
  rep.onclick = () => reportQuestion(q, quiz && quiz.mode === 'study' ? quiz.ans[k] : null);   // exam mode: no key in the text
  tools.append(flag, rep); meta.append(tools);
  renderStem($('qText'), q.q);
  if (hasFigures(q)) $('qText').append(figures(q));
  const box = $('choices'); box.innerHTML = '';
  const struck = quiz.strikes[k] || [];
  const zoned = quiz.mode === 'study' && settings.confStyle === 'zones' && !a;
  box.classList.toggle('zoned', zoned);
  Object.keys(q.c).sort().forEach(L => {
    // 3-zone mode: one tap answers and rates confidence (left guess · middle shaky · right confident)
    const b = el(zoned ? 'div' : 'button', 'choice' + (zoned ? ' zoned' : '')); b.dataset.letter = L;
    if (struck.includes(L)) b.classList.add('struck');
    if (a && a.pick === L && quiz.mode === 'exam') b.classList.add('sel');
    const lt = el('span', 'letter', L), tx = el('span', 'txt', q.c[L]);
    const sk = el('button', 'strike'); sk.innerHTML = ic('strike'); sk.setAttribute('aria-label', 'Eliminate this option'); sk.title = 'Eliminate';
    sk.onclick = e => { e.stopPropagation(); toggleStrike(L); };
    if (zoned) {
      const zones = el('div', 'zones');
      CONF_LABEL.forEach((name, c) => {
        const z = el('button', 'zone z' + c); z.type = 'button';
        z.setAttribute('aria-label', `${L}, ${q.c[L]}: ${name.toLowerCase()}`);
        z.append(el('span', 'zl', name));
        onTap(z, () => { if (!quiz.ans[k]) commit(L, c); });
        zones.append(z);
      });
      b.append(zones, lt, tx, sk);
    } else {
      b.append(lt, tx, sk);
      onTap(b, () => onChoice(L));
    }
    box.appendChild(b);
  });
  $('confBox').innerHTML = ''; $('explBox').innerHTML = '';
  renderActions();
  if (quiz.mode === 'study' && a) paintAnswer(a);   // revisiting an answered question after resume
  $('kbdHint').textContent = quiz.mode === 'exam' ? 'A–E select · ←/→ move · F flag · Enter next' : 'A–E answer · 1/2/3 guess/shaky/confident · Enter next · F flag · shift+letter eliminate';
  window.scrollTo({ top: 0 });
}
function renderActions() {
  const box = $('quizActions'); box.innerHTML = '';
  if (quiz.mode === 'exam') {
    const prev = el('button', 'btn ghost'); prev.innerHTML = '<span class="ms" aria-hidden="true">chevron_left</span>Prev'; prev.disabled = quiz.idx === 0; prev.onclick = () => go(quiz.idx - 1);
    const last = quiz.idx + 1 >= quiz.keys.length;
    const nxt = el('button', 'btn'); nxt.innerHTML = last ? 'Submit block' : 'Next<span class="ms" aria-hidden="true">chevron_right</span>'; nxt.onclick = () => last ? submitExam() : go(quiz.idx + 1);
    box.append(prev, nxt);
  } else if (quiz.ans[curKey()]) {
    const nb = el('button', 'btn', quiz.idx + 1 >= quiz.keys.length ? 'See results' : 'Next'); nb.id = 'nextBtn'; nb.onclick = next;
    box.append(nb);
  }
}
function renderScoreChip() {
  const vals = Object.values(quiz.ans), c = vals.filter(a => a.ok).length, w = vals.filter(a => a.pick && !a.ok).length;
  const sc = $('quizScore'); sc.className = 'quiz-score';
  sc.innerHTML = `<span class="g">${ic('check')}${c}</span>&nbsp; <span class="b">${ic('cross')}${w}</span>`;
}
function isFlagged(k) { const s = stats()[k]; return !!(s && s.fl); }
function toggleFlag(k) {
  const s = entry(k); if (s.fl) delete s.fl; else s.fl = 1;
  persistStats(); toast(s.fl ? 'Flagged for review' : 'Flag removed');
}
function toggleStrike(L) {
  const k = curKey(); if (quiz.ans[k] && quiz.mode === 'study') return;
  const arr = quiz.strikes[k] || (quiz.strikes[k] = []);
  const i = arr.indexOf(L); if (i >= 0) arr.splice(i, 1); else arr.push(L);
  document.querySelector(`.choice[data-letter="${L}"]`)?.classList.toggle('struck', i < 0);
  saveSession();
}
function onChoice(L) {
  const k = curKey();
  if (quiz.mode === 'exam') {
    const a = quiz.ans[k];
    if (a && a.pick === L) delete quiz.ans[k]; else quiz.ans[k] = { pick: L };
    quiz.time[k] = (quiz.time[k] || 0) + (now() - quiz.qStart) / 1000; quiz.qStart = now();
    document.querySelectorAll('.choice').forEach(b => b.classList.toggle('sel', !!quiz.ans[k] && b.dataset.letter === L));
    $('quizBar').style.width = (answeredCount() / quiz.keys.length * 100) + '%';
    saveSession();
    return;
  }
  if (quiz.ans[k]) return;
  if (!settings.confidence) { commit(L, -1); return; }
  if (quiz.sel === L) { commit(L, -1); return; }          // tap again = skip the confidence step
  quiz.sel = L;
  document.querySelectorAll('.choice').forEach(b => b.classList.toggle('sel', b.dataset.letter === L));
  const cb = $('confBox');
  cb.innerHTML = `<div class="conf-bar"><div class="lbl"><span>How sure are you?</span><span>tap ${L} again to skip</span></div><div class="opts">
    ${CONF_LABEL.map((l, i) => `<button data-c="${i}">${ic(CONF_IC[i])}${l}<small>${['below 50%', '50–85%', 'over 85%'][i]}</small></button>`).join('')}</div></div>`;
  cb.querySelectorAll('button').forEach(b => b.onclick = () => commit(L, +b.dataset.c));
  cb.firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function commit(L, conf) {
  const q = curQ(), k = q.k;
  if (quiz.ans[k]) return;
  const ok = L === q.a, sec = clamp((now() - quiz.qStart) / 1000, 0, 600);
  const a = { pick: L, ok, conf, sec: Math.round(sec) };
  quiz.ans[k] = a; quiz.sel = null;
  recordAttempt(k, L, ok, conf, sec);
  saveSession();
  $('confBox').innerHTML = '';
  paintAnswer(a);
  renderScoreChip();
  renderActions();
  if (settings.autoAdvance && ok && quiz.idx + 1 < quiz.keys.length) {
    autoAdvanceId = setTimeout(() => { if (quiz && quiz.ans[k]) next(); }, 1400);
  }
}
function paintAnswer(a) {
  const q = curQ(), k = q.k, s = stats()[k] || {};
  $('choices').classList.remove('zoned');
  document.querySelectorAll('.choice.zoned').forEach(c => { c.classList.remove('zoned'); c.querySelector('.zones')?.remove(); });
  document.querySelectorAll('.choice').forEach(b => {
    b.classList.add('locked'); b.classList.remove('sel');
    const bl = b.dataset.letter;
    if (bl === q.a) b.classList.add('correct'); else if (bl === a.pick) b.classList.add('wrong'); else b.classList.add('dim');
  });
  const box = $('explBox'); box.innerHTML = '';
  const card = el('div', 'expl');
  const v = el('div', 'verdict ' + (a.ok ? 'good' : 'bad'));
  { const vt = el('span'); vt.innerHTML = a.ok ? `${ic('check')}Correct` : `${ic('cross')}Incorrect — answer is ${q.a}`; v.append(vt); }
  const metaBits = [];
  if (a.conf >= 0) metaBits.push(CONF_LABEL[a.conf]);
  if (a.sec) metaBits.push(a.sec + 's');
  if (q.df !== null) metaBits.push(`${diffWord(q.df)} nationally (${q.df}/1000)`);
  if (metaBits.length) v.append(el('span', 'meta', metaBits.join(' · ')));
  card.append(v, el('div', 'body', q.e || 'No explanation available for this item.'));
  card.append(...sourceNotes(q));
  if (q.x) card.append(el('div', 'next-due', `ABFM removed this item from ${q.y} scoring for a ${q.x} reason${q.x === 'content' ? ' (ambiguous or more than one defensible answer)' : ''}. Weigh the key accordingly.`));
  if (!a.ok && a.conf === 2) card.append(el('div', 'next-due', 'Confident miss — this one is a misconception worth a note. It comes back tomorrow.'));
  else if (a.ok && a.conf === 0) card.append(el('div', 'next-due', 'Correct, but a guess — scheduled again soon so it actually sticks.'));
  else if (s.due) card.append(el('div', 'next-due', `Next review ${relDays(s.due)}.`));
  card.append(noteBox(k));
  box.append(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function noteBox(k) {
  const wrap = el('div', 'note-box');
  const lbl = el('div', 'lbl'); lbl.append(el('span', '', 'My note'), el('span', '', 'saved automatically'));
  const ta = el('textarea'); ta.placeholder = 'Why did I miss this? What is the one-line takeaway?'; ta.value = (stats()[k] && stats()[k].nt) || '';
  let t = null;
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const s = entry(k); if (ta.value.trim()) s.nt = ta.value.trim(); else delete s.nt; persistStats(); }, 400); });
  wrap.append(lbl, ta);
  return wrap;
}
function go(i) { quiz.idx = clamp(i, 0, quiz.keys.length - 1); saveSession(); renderQuestion(); }
function next() {
  clearTimeout(autoAdvanceId);
  quiz.idx++;
  saveSession();
  if (quiz.idx >= quiz.keys.length) finishQuiz(); else renderQuestion();
}
$('quizPos').addEventListener('click', () => { if (quiz && quiz.mode === 'exam') openNavigator(); });
function openNavigator() {
  sheet('Question navigator', body => {
    const grid = el('div', 'navgrid');
    quiz.keys.forEach((k, i) => {
      const b = el('button', (quiz.ans[k] ? 'done' : '') + (i === quiz.idx ? ' cur' : '') + (quiz.flags[k] || isFlagged(k) ? ' flag' : ''), i + 1);
      b.onclick = () => { closeSheet(); go(i); };
      grid.append(b);
    });
    const leg = el('div', 'navlegend');
    leg.innerHTML = `<span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>answered</span><span><i style="background:var(--surface2);border:1px solid var(--border)"></i>blank</span><span><i style="background:var(--gold);border-radius:50%"></i>flagged</span>`;
    const sub = el('button', 'btn', `Submit block (${answeredCount()}/${quiz.keys.length} answered)`); sub.style.marginTop = '14px';
    sub.onclick = () => { closeSheet(); submitExam(); };
    body.append(grid, leg, sub);
  });
}
async function submitExam() {
  const blank = quiz.keys.length - answeredCount();
  if (blank && !(await dialog({ title: 'Submit with blanks?', msg: `${blank} question${blank === 1 ? ' is' : 's are'} unanswered and will count as incorrect. Submit anyway?`, ok: 'Submit' }))) return;
  finishQuiz();
}
$('quitBtn').addEventListener('click', async () => {
  if (!quiz) return;
  const n = answeredCount();
  if (quiz.mode === 'exam') {
    if (!n) { stopTimer(); quiz = null; store.del('session'); showView('home'); return; }
    const finish = await dialog({ title: 'Leave the block?', msg: `${n} of ${quiz.keys.length} answered. Submit and score now, or save your place (the clock pauses).`, ok: 'Submit now', cancel: 'Save & leave' });
    if (finish) finishQuiz(); else { saveSession(); stopTimer(); quiz = null; showView('home'); }
    return;
  }
  if (quiz.idx >= quiz.keys.length) { finishQuiz(); return; }
  if (!n) { stopTimer(); quiz = null; store.del('session'); showView('home'); return; }
  const finishNow = await dialog({ title: 'Leave session?', msg: `You've answered ${n} of ${quiz.keys.length}. Score what you've done, or save your spot for later.`, ok: 'Finish & score', cancel: 'Save for later' });
  if (finishNow) { quiz.keys = quiz.keys.filter(k => quiz.ans[k]); quiz.idx = quiz.keys.length; finishQuiz(); }
  else { saveSession(); stopTimer(); quiz = null; showView('home'); }
});

document.addEventListener('keydown', e => {
  if ($('sheetBackdrop').classList.contains('on')) { if (e.key === 'Escape') closeSheet(); return; }
  if ($('dlgBackdrop').classList.contains('on')) return;
  if (!quiz || currentView !== 'quiz') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const L = e.key.toUpperCase(), k = curKey(), answered = !!quiz.ans[k];
  if (['A', 'B', 'C', 'D', 'E'].includes(L) && document.querySelector(`.choice[data-letter="${L}"]`)) {
    e.preventDefault();
    if (e.shiftKey) { if (quiz.mode === 'exam' || !answered) toggleStrike(L); }
    else if (quiz.mode === 'exam' || !answered) onChoice(L);
    return;
  }
  if (quiz.mode === 'study' && quiz.sel && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); commit(quiz.sel, +e.key - 1); return; }
  if (L === 'F') { e.preventDefault(); toggleFlag(k); document.querySelector('.q-meta .icon-btn')?.classList.toggle('on', isFlagged(k)); return; }
  if (quiz.mode === 'exam') {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (quiz.idx + 1 < quiz.keys.length) go(quiz.idx + 1); else submitExam(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(quiz.idx - 1); }
    return;
  }
  if ((e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') && answered) { e.preventDefault(); next(); }
});

/* ---------------- results ---------------- */
let lastResult = null;
function finishQuiz() {
  stopTimer();
  const done = quiz; quiz = null;
  store.del('session');
  if (done.mode === 'exam') {
    // Grade now: stats are only recorded at submission in exam mode.
    done.keys.forEach(k => {
      const a = done.ans[k], q = BY_KEY.get(k);
      if (a && a.pick) { a.ok = a.pick === q.a; a.conf = -1; a.sec = Math.round(done.time[k] || 0); recordAttempt(k, a.pick, a.ok, -1, a.sec); }
      else done.ans[k] = { pick: null, ok: false, conf: -1, sec: Math.round(done.time[k] || 0) };
    });
  }
  const list = done.keys.map(k => Object.assign({ k }, done.ans[k])).filter(a => a.pick !== undefined);
  if (!list.length) { showView('home'); return; }
  const domTally = {};
  list.forEach(a => { const d = domTally[BY_KEY.get(a.k).d] || [0, 0]; d[1]++; if (a.ok) d[0]++; domTally[BY_KEY.get(a.k).d] = d; });
  const score = list.filter(a => a.ok).length;
  const ms = done.mode === 'exam' ? (done.acc + (now() - done.t0)) : list.reduce((s, a) => s + (a.sec || 0) * 1000, 0);
  const rec = { t: done.t, label: done.label, n: list.length, score, d: domTally, mode: done.mode, ms, src: done.src, ans: list.map(a => ({ k: a.k, p: a.pick, ok: a.ok ? 1 : 0, c: a.conf, s: a.sec || 0 })) };
  if (done.src && done.src.type === 'full') {
    const y = done.src.y, ym = yearMeta(y);
    rec.form = y;
    if (ym) {
      const scoredAns = list.filter(a => !BY_KEY.get(a.k).x);
      rec.raw = scoredAns.filter(a => a.ok).length; rec.scoredN = scoredAns.length;
      rec.scaled = scoredAns.length === ym.scored ? scaledFor(y, rec.raw) : null;
    }
  }
  const h = history(); h.unshift(rec);
  if (h.length > 300) h.length = 300;
  h.forEach((x, i) => { if (i >= 120) delete x.ans; });   // keep per-question detail for recent sessions only
  store.set('history', h);
  autoSnapshot();
  lastResult = rec;
  renderResults(rec);
  showView('results');
}
function renderResults(rec) {
  const n = rec.n, p = pct(rec.score, n);
  $('resPct').textContent = p + '%';
  $('resFrac').textContent = `${rec.score} / ${n}`;
  $('resLabel').textContent = rec.label + (rec.mode === 'exam' ? ' · exam mode' : '');
  const bits = [];
  if (rec.ms) bits.push(fmtDur(rec.ms), `${Math.round(rec.ms / 1000 / n)} s/question`);
  const blanks = rec.ans.filter(a => a.p === null).length; if (blanks) bits.push(`${blanks} unanswered`);
  $('resSub').textContent = bits.join(' · ');
  const ring = $('ringFg');
  ring.style.stroke = p >= 70 ? 'var(--good)' : p >= 50 ? 'var(--gold)' : 'var(--bad)';
  ring.style.strokeDashoffset = 465;
  requestAnimationFrame(() => requestAnimationFrame(() => ring.style.strokeDashoffset = 465 * (1 - p / 100)));
  // insights
  const ins = $('resInsights'); ins.innerHTML = '';
  if (rec.form) ins.append(scaledCard(rec));
  else if (rec.mode === 'exam') { const nc = normsCard(rec); if (nc) ins.append(nc); }
  const guessesRight = rec.ans.filter(a => a.c === 0 && a.ok).length, certainWrong = rec.ans.filter(a => a.c === 2 && !a.ok).length, certain = rec.ans.filter(a => a.c === 2).length;
  const lines = [];
  if (certain) lines.push(`You said <b>Confident</b> ${certain}× and were right ${certain - certainWrong}×${certainWrong ? ` — the ${certainWrong} confident miss${certainWrong > 1 ? 'es are' : ' is'} your highest-yield review` : ' — well calibrated'}.`);
  if (guessesRight) lines.push(`${guessesRight} correct guess${guessesRight > 1 ? 'es' : ''} scheduled for early re-review rather than counted as learned.`);
  if (rec.mode === 'exam' && rec.ms) { const sq = rec.ms / 1000 / n; lines.push(sq > settings.secPerQ ? `Pace was <b>${Math.round(sq)} s/question</b>, slower than the ~${settings.secPerQ} s the ITE allows.` : `Pace ${Math.round(sq)} s/question — on track for the ITE's ~${settings.secPerQ} s.`); }
  if (lines.length) { const c = el('div', 'card tinted'); c.style.marginBottom = '10px'; c.innerHTML = lines.map(l => `<p class="sub" style="color:var(--text2)">${l}</p>`).join(''); ins.append(c); }
  // domain breakdown
  const rd = $('resDomains'); rd.innerHTML = '';
  Object.entries(rec.d).sort((a, b) => b[1][1] - a[1][1]).forEach(([dom, [c, t]]) => {
    const row = el('div', 'dom-row');
    const bar = el('span', 'bar'); const fill = el('div'); fill.style.width = (c / t * 100) + '%'; if (c / t < 0.5) fill.style.background = 'var(--bad)'; bar.append(fill);
    row.append(el('span', 'name', dom), el('span', 'frac', `${c}/${t}`), bar);
    rd.append(row);
  });
  renderBackupNudge();
  renderReview($('reviewTabs'), $('reviewList'), rec, true);
  const wrong = rec.ans.filter(a => !a.ok);
  $('retryMissedBtn').classList.toggle('hidden', !wrong.length);
  $('retryMissedBtn').onclick = () => startQuiz(shuffle(wrong.map(a => a.k)), 'Retry missed', 'study', { type: 'retry', keys: wrong.map(a => a.k) });
  $('againBtn').classList.toggle('hidden', !rec.src);
  $('againBtn').onclick = () => againLike(rec.src, rec.mode);
}
function scaledCard(rec) {
  const ym = yearMeta(rec.form), c = el('div', 'card tinted scaled-card'); c.style.marginBottom = '10px';
  if (!ym) { c.innerHTML = `<div class="lbl">Full ITE ${rec.form}</div><p class="sub">No ABFM scoring table for this form yet, so only percent correct is shown.</p>`; return c; }
  if (rec.scaled === null || rec.scaled === undefined) { c.innerHTML = `<div class="lbl">Full ITE ${rec.form}</div><p class="sub">The official conversion needs every scored item: this bank has ${rec.scoredN} of ${ym.scored}. Raw ${rec.raw}/${rec.scoredN} on scored items.</p>`; return c; }
  const sc = rec.scaled, mps = META.minimumPassingScore, re = META.reassuringScore, pos = v => ((v - 200) / 600 * 100).toFixed(1) + '%';
  const verdict = sc >= re ? `At or above ${re}: ABFM calls this range "very reassuring" for passing the FMCE.` : sc >= mps ? `Above the FMCE passing standard (${mps}), below the ${re} "reassuring" line.` : `Below the FMCE passing standard of ${mps}.`;
  c.innerHTML = `<div class="lbl">Official ABFM scaled score · ${rec.form} form</div><div class="big">${sc}</div>
    <div class="sub">raw ${rec.raw} of ${ym.scored} scored items · ±${META.sem} (1 SEM)</div>
    <div class="scale"><div class="fill" style="width:${pos(sc)}"></div><div class="mark" style="left:${pos(mps)}"><small>pass ${mps}</small></div><div class="mark" style="left:${pos(re)}"><small>${re}</small></div><div class="me" style="left:${pos(sc)}"></div></div>
    <div class="norms">${[1, 2, 3].map(p => `<span class="${settings.pgy === p ? 'me' : ''}">PGY-${p} mean ${Math.round(ym.norms[p].scaled)}</span>`).join('')}</div>
    <div class="verdict-line">${verdict} National means are from the ${rec.form} ITE (n=${ym.examinees.toLocaleString()}).</div>`;
  return c;
}
function normsCard(rec) {
  // Percent-correct benchmarks for exam-mode sessions drawn from forms with national data.
  const years = {}; rec.ans.forEach(a => { const q = BY_KEY.get(a.k); if (q && yearMeta(q.y)) years[q.y] = (years[q.y] || 0) + 1; });
  const n = Object.values(years).reduce((s, v) => s + v, 0); if (n < Math.max(10, rec.n * 0.8)) return null;
  const mean = p => Object.entries(years).reduce((s, [y, cnt]) => s + yearMeta(+y).norms[p].pct * cnt, 0) / n;
  const mine = rec.score / rec.n * 100;
  const c = el('div', 'card'); c.style.marginBottom = '10px';
  c.innerHTML = `<h3>Against national ITE means</h3><div class="sub">Percent correct on these forms · you ${Math.round(mine)}%</div>
    <div class="norms" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${[1, 2, 3].map(p => `<span class="pill-btn ${settings.pgy === p ? 'on' : ''}" style="cursor:default">PGY-${p} ${mean(p).toFixed(0)}%</span>`).join('')}</div>
    <div class="verdict-line">Small samples swing a lot: ${rec.n} questions has a 95% interval of about ±${Math.round(196 * Math.sqrt(0.25 / rec.n))} points. Set your training year in More → Study settings.</div>`;
  return c;
}
function againLike(src, mode) {
  if (!src) return;
  switch (src.type) {
    case 'smart': { const p = smartPlan(); return p.keys.length && startQuiz(p.keys, 'Smart session', 'study', src); }
    case 'quick': return startQuiz(shuffle(pickableKeys()).slice(0, src.n), `Quick ${src.n}`, 'study', src);
    case 'timed': return startQuiz(shuffle(pickableKeys()).slice(0, src.n), 'Timed block', 'exam', src);
    case 'full': return startQuiz(fullFormKeys(src.y), `Full ITE ${src.y}`, 'exam', src);
    case 'missed': { const k = shuffle(missedKeys()); return k.length ? startQuiz(k.slice(0, 40), 'Missed review', 'study', src) : toast('Nothing missed to review'); }
    case 'flagged': { const k = shuffle(flaggedKeys()); return k.length ? startQuiz(k, 'Flagged review', 'study', src) : toast('Nothing flagged'); }
    case 'domain': return startDomain(src.d);
    case 'tier': return startTier(src.id);
    case 'retry': return startQuiz(shuffle(src.keys.filter(k => BY_KEY.has(k))), 'Retry missed', 'study', src);
    case 'browse': return startQuiz(shuffle(src.keys.filter(k => BY_KEY.has(k))).slice(0, 100), src.label || 'Browse results', 'study', src);
    case 'custom': { let keys = shuffle(builderKeys(src.cfg)); if (src.n) keys = keys.slice(0, src.n); return keys.length ? startQuiz(keys, builderLabel(src.cfg), mode, src) : toast('No questions match that filter any more'); }
  }
}
function renderReview(tabsBox, listBox, rec, showTabs) {
  const filters = { All: () => true, Missed: a => !a.ok, Flagged: a => isFlagged(a.k), Guessed: a => a.c === 0 };
  let cur = rec.ans.some(a => !a.ok) ? 'Missed' : 'All';
  const draw = () => {
    tabsBox.innerHTML = '';
    if (showTabs) Object.keys(filters).forEach(name => {
      const n = rec.ans.filter(filters[name]).length; if (name !== 'All' && !n) return;
      const b = el('button', 'pill-btn' + (name === cur ? ' on' : ''), `${name} ${n}`); b.onclick = () => { cur = name; draw(); }; tabsBox.append(b);
    });
    listBox.innerHTML = '';
    const items = rec.ans.filter(filters[cur]);
    if (!items.length) { listBox.append(el('div', 'empty', 'Nothing here.')); return; }
    items.forEach(a => listBox.append(reviewItem(a)));
  };
  draw();
}
function reviewItem(a) {
  const q = BY_KEY.get(a.k); if (!q) return el('div');
  const item = el('div', 'review-item');
  const head = el('button', 'review-q');
  const mark = el('span', 'mark ' + (a.p === null ? 'n' : a.ok ? 'g' : 'b')); mark.innerHTML = ic(a.p === null ? 'blank' : a.ok ? 'check' : 'cross');
  const tx = el('span', 'tx', q.q.split('\n')[0].slice(0, 150) + (q.q.length > 150 ? '…' : ''));
  const meta = el('span', 'meta', [q.d, a.c >= 0 ? CONF_LABEL[a.c] : null, a.s ? a.s + 's' : null, isFlagged(a.k) ? 'flagged' : null].filter(Boolean).join(' · '));
  const col = el('span', 'col'); col.append(tx, meta);
  head.append(mark, col);
  const detail = el('div', 'review-detail hidden');
  head.onclick = () => { if (detail.classList.contains('hidden') && !detail.childElementCount) detail.append(questionDetail(q, { pick: a.p, revealed: true })); detail.classList.toggle('hidden'); };
  item.append(head, detail);
  return item;
}
/* Full question card used by review lists and the browser. */
function questionDetail(q, { pick = null, revealed = false } = {}) {
  const wrap = el('div');
  const stem = el('div', 'q-text'); renderStem(stem, q.q); if (hasFigures(q)) stem.append(figures(q)); wrap.append(stem);
  const ch = el('div', 'choices');
  const paint = () => {
    ch.innerHTML = '';
    Object.keys(q.c).sort().forEach(L => {
      const b = el('div', 'choice locked'); b.append(el('span', 'letter', L), el('span', 'txt', q.c[L]));
      if (revealed) { if (L === q.a) b.classList.add('correct'); else if (L === pick) b.classList.add('wrong'); else b.classList.add('dim'); }
      ch.append(b);
    });
  };
  paint(); wrap.append(ch);
  const after = el('div');
  const showExpl = () => {
    after.innerHTML = '';
    const ex = el('div', 'ex'); ex.textContent = q.e || 'No explanation available.'; after.append(ex, ...sourceNotes(q));
    const s = stats()[q.k];
    if (attempted(s)) { const hist = el('div', 'detail-hist'); hist.textContent = `Answered ${s.s}× · ${s.c} correct · last ${agoDays(s.l)} ${s.lc ? '(right)' : '(missed)'}${s.due ? ` · next review ${relDays(s.due)}` : ''}`; after.append(hist); }
    const tools = el('div', 'row'); tools.style.marginTop = '10px';
    const flag = el('button', 'pill-btn');
    const paintFlag = () => { flag.classList.toggle('on', isFlagged(q.k)); flag.innerHTML = ic('flag') + (isFlagged(q.k) ? 'Flagged' : 'Flag'); };
    paintFlag(); flag.onclick = () => { toggleFlag(q.k); paintFlag(); };
    const rep = el('button', 'pill-btn report'); rep.innerHTML = ic('report') + 'Report'; rep.title = 'Report a problem with this question';
    rep.onclick = () => reportQuestion(q, { pick, revealed: true });
    tools.append(flag, rep); after.append(tools, noteBox(q.k));
  };
  if (revealed) showExpl();
  else { const rb = el('button', 'btn ghost', 'Reveal answer'); rb.style.marginTop = '12px'; rb.onclick = () => { revealed = true; paint(); showExpl(); }; after.append(rb); }
  wrap.append(after);
  return wrap;
}
$('doneBtn').addEventListener('click', () => showView('home'));

/* ---------------- browse ---------------- */
let browseShown = 50, browseKeys = [];
function buildBrowseUI() {
  const by = $('bYear'), bc = $('bCat'), bb = $('bBP');
  YEARS.forEach(y => by.append(new Option(y, y)));
  DOMAINS.forEach(d => bc.append(new Option(d, d)));
  if (QUESTIONS.some(q => q.b)) BLUEPRINTS.forEach(b => bb.append(new Option(`${b} (${META.blueprint[b]}%)`, b))); else bb.classList.add('hidden');
  let t = null;
  $('searchInput').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderBrowse, 120); $('searchClear').classList.toggle('hidden', !$('searchInput').value); });
  $('searchClear').addEventListener('click', () => { $('searchInput').value = ''; $('searchClear').classList.add('hidden'); renderBrowse(); });
  if (!QUESTIONS.some(q => q.df !== null)) $('bDiff').classList.add('hidden');
  [by, bc, bb, $('bStatus'), $('bDiff')].forEach(s => s.addEventListener('change', () => { s.classList.toggle('set', !!s.value); renderBrowse(); }));
  $('browseMore').addEventListener('click', () => { browseShown += 50; drawBrowseList(); });
  $('browseQuiz').addEventListener('click', () => {
    const keys = shuffle(browseKeys).slice(0, 100);
    const label = $('searchInput').value.trim() ? `“${$('searchInput').value.trim().slice(0, 30)}”` : [$('bCat').value, $('bYear').value, $('bStatus').value].filter(Boolean).join(' · ') || 'Browse results';
    startQuiz(keys, label, 'study', { type: 'browse', keys: browseKeys, label });
  });
}
function renderBrowse() {
  const qtxt = $('searchInput').value.trim().toLowerCase(), toks = qtxt.split(/\s+/).filter(Boolean);
  const y = $('bYear').value, d = $('bCat').value, bp = $('bBP').value, status = $('bStatus').value, df = $('bDiff').value, st = stats(), t = now();
  browseKeys = [];
  for (const q of QUESTIONS) {
    if (hiddenAi(q) && status !== 'aiflag') continue;
    if (status === 'aiflag' && !q.ai && !q.er) continue;
    if (y && String(q.y) !== y) continue;
    if (d && q.d !== d) continue;
    if (bp && q.b !== bp) continue;
    if (df === 'hard' && !(q.df >= 600)) continue;
    if (df === 'medium' && !(q.df > 150 && q.df < 600)) continue;
    if (df === 'easy' && !(q.df !== null && q.df <= 150)) continue;
    if (df === 'none' && q.df !== null) continue;
    const s = st[q.k];
    if (status === 'unseen' && attempted(s)) continue;
    if (status === 'correct' && !(attempted(s) && s.lc)) continue;
    if (status === 'missed' && !(attempted(s) && !s.lc)) continue;
    if (status === 'flagged' && !(s && s.fl)) continue;
    if (status === 'noted' && !(s && s.nt)) continue;
    if (status === 'due' && !isDue(s, t)) continue;
    if (toks.length) { const text = SEARCH_INDEX[QUESTIONS.indexOf(q)].t; if (!toks.every(tk => text.includes(tk))) continue; }
    browseKeys.push(q.k);
  }
  browseShown = 50;
  drawBrowseList(toks);
}
function drawBrowseList(toks) {
  toks = toks || $('searchInput').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = $('browseList'); list.innerHTML = '';
  $('browseCount').textContent = `${browseKeys.length} question${browseKeys.length === 1 ? '' : 's'}`;
  $('browseQuiz').classList.toggle('hidden', !browseKeys.length);
  $('browseQuiz').textContent = `Quiz me on these (${Math.min(browseKeys.length, 100)})`;
  const st = stats();
  browseKeys.slice(0, browseShown).forEach(k => {
    const q = BY_KEY.get(k), s = st[k];
    const b = el('button', 'bitem');
    const status = el('span', 'st ' + (attempted(s) ? (s.lc ? 'g' : 'b') : 'n')); status.innerHTML = ic(attempted(s) ? (s.lc ? 'check' : 'cross') : 'unseen');
    const body = el('div', 'tx');
    const snippet = snippetFor(q, toks);
    body.innerHTML = highlight(snippet, toks);
    const mt = el('div', 'mt');
    mt.append(el('span', '', `${q.y} · #${q.n}`), el('span', '', q.d));
    if (q.b) mt.append(el('span', '', bpShort(q.b)));
    const tag = (cls, name, text) => { const t = el('span', cls); t.innerHTML = ic(name) + esc(text); mt.append(t); };
    if (q.x) tag('f', 'warn', 'removed from scoring');
    if (s && s.fl) tag('f', 'flag', 'flagged');
    if (s && s.nt) tag('', 'note', 'note');
    if (hasFigures(q)) tag('', 'image', 'image');
    if (q.ai) tag('f', 'warn', q.ai.s === 'outdated' ? 'flagged by AI: outdated' : 'AI note');
    if (q.er) tag('', 'note', 'errata');
    if (q.df !== null) mt.append(el('span', '', `${diffWord(q.df)} · ${q.df}`));
    if (attempted(s)) mt.append(el('span', '', `${s.c}/${s.s} correct`));
    const inner = el('div'); inner.style.flex = '1'; inner.style.minWidth = '0'; inner.append(body, mt);
    b.append(status, inner);
    b.onclick = () => sheet(`${q.y} · #${q.n} · ${q.d}`, box => { box.append(questionDetail(q, { revealed: settings.revealInBrowse })); return () => { if (currentView === 'browse') drawBrowseList(); }; });
    list.append(b);
  });
  $('browseMore').classList.toggle('hidden', browseKeys.length <= browseShown);
}
function snippetFor(q, toks) {
  const stem = q.q.replace(/\s*\n\s*/g, ' ');
  if (!toks.length) return stem.slice(0, 220);
  const lower = stem.toLowerCase(); let i = -1;
  for (const t of toks) { i = lower.indexOf(t); if (i >= 0) break; }
  if (i < 0) { const e = (q.e || '').toLowerCase(); for (const t of toks) { const j = e.indexOf(t); if (j >= 0) return '…' + q.e.slice(Math.max(0, j - 70), j + 150) + '…'; } return stem.slice(0, 220); }
  const start = Math.max(0, i - 80);
  return (start ? '…' : '') + stem.slice(start, start + 220);
}
function highlight(text, toks) {
  let html = esc(text);
  toks.forEach(t => { if (t.length < 2) return; html = html.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); });
  return html;
}

/* ---------------- stats view ---------------- */
function renderStats() {
  const o = overall(), ft = firstTryAccuracy(), wk = recentAccuracy(7), rt = retention(7);
  $('sAcc').textContent = o.attempts ? pct(o.correct, o.attempts) + '%' : '–';
  $('sFirst').textContent = ft.n >= 5 ? pct(ft.c, ft.n) + '%' : '–';
  $('sWeek').textContent = wk.n ? pct(wk.c, wk.n) + '%' : '–';
  $('sRet').textContent = rt.n >= 5 ? pct(rt.c, rt.n) + '%' : '–';
  $('sRet').parentElement.title = 'Accuracy when re-answering a question 7+ days after the last attempt';
  renderTrend(); renderSims(); renderCalendar(); renderForecast(); renderCalibration(); renderMastery(); renderBlueprint(); renderPace(); renderHistory();
  $('statsNote').innerHTML = `${o.attempts} answers · ${o.seen}/${QUESTIONS.length} questions seen · 1st-try accuracy counts only the first time you saw each question · retention = accuracy on re-attempts ≥7 days apart`;
}
function renderTrend() {
  const h = history().slice(0, 60).reverse();
  const box = $('trendChart');
  if (h.length < 2) { box.innerHTML = '<div class="empty">Finish a couple of sessions and your score trend will appear here.</div>'; return; }
  const W = 600, H = 200, padL = 34, padR = 10, padT = 12, padB = 24, iw = W - padL - padR, ih = H - padT - padB;
  const x = i => padL + i / (h.length - 1) * iw, y = p => padT + (1 - p / 100) * ih;
  const vals = h.map(e => e.score / e.n * 100);
  const roll = vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 4), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  const line = roll.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${padL},${padT + ih} ${line} ${x(h.length - 1).toFixed(1)},${padT + ih}`;
  const grid = [0, 50, 100].map(p => `<line x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}" stroke="var(--border)"/><text x="${padL - 8}" y="${y(p) + 4}" fill="var(--muted)" font-size="11" text-anchor="end">${p}</text>`).join('');
  const dots = h.map((e, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(vals[i]).toFixed(1)}" r="${e.mode === 'exam' ? 4 : 3}" fill="${e.mode === 'exam' ? 'var(--surface)' : 'var(--accent)'}" stroke="var(--accent)" stroke-width="${e.mode === 'exam' ? 2 : 0}" opacity="0.9"><title>${esc(e.label)} · ${Math.round(vals[i])}% · ${fmtDate(e.t)}</title></circle>`).join('');
  const fmt = d => (d.getMonth() + 1) + '/' + d.getDate();
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Score trend">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<polygon points="${area}" fill="url(#ag)"/>
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${padL}" y="${H - 6}" fill="var(--muted)" font-size="11">${fmt(new Date(h[0].t))}</text>
    <text x="${W - padR}" y="${H - 6}" fill="var(--muted)" font-size="11" text-anchor="end">${fmt(new Date(h[h.length - 1].t))}</text></svg>
  <div class="stat-legend"><span>last ${h.length} sessions · line = 5-session average</span><span>● tutor &nbsp;○ exam</span></div>`;
}
function renderCalendar() {
  const box = $('calendarCard');
  const counts = {}; for (const a of allAttempts()) counts[dayKey(a.t)] = (counts[dayKey(a.t)] || 0) + 1;
  history().forEach(h => { if (!h.ans) { const k = dayKey(h.t); counts[k] = Math.max(counts[k] || 0, h.n); } });   // legacy sessions without attempt logs
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - start.getDay() - 77);   // 12 weeks, Sunday-aligned
  const goal = settings.dailyGoal || 20;
  let html = '<div class="heat-wrap">', total = 0, active = 0;
  for (let w = 0; w < 12; w++) {
    html += '<div class="col">';
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
      const n = counts[dayKey(day)] || 0; total += n; if (n) active++;
      const lvl = !n ? '' : n >= goal ? 'l4' : n >= goal * 0.6 ? 'l3' : n >= goal * 0.3 ? 'l2' : 'l1';
      html += `<div class="hd ${lvl}${day.getTime() === today.getTime() ? ' today' : ''}${day > today ? ' future' : ''}" title="${fmtDate(day)}: ${n} answers"></div>`;
    }
    html += '</div>';
  }
  html += '</div>';
  box.innerHTML = html + `<div class="stat-legend"><span>${active} active day${active === 1 ? '' : 's'} · ${total} answers in 12 weeks</span><span>streak ${dayStreak()} · goal ${goal}/day</span></div>`;
}
function renderForecast() {
  const st = stats(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const bins = Array(7).fill(0); let overdue = 0;
  for (const k in st) { const s = st[k]; if (!attempted(s) || !BY_KEY.has(k) || !s.due) continue; const d = Math.floor((s.due - t0) / DAY); if (d < 0) overdue++; else if (d < 7) bins[d]++; }
  bins[0] += overdue;
  const max = Math.max(1, ...bins);
  const box = $('forecastCard');
  if (!bins.some(Boolean) && !overall().attempts) { box.innerHTML = '<div class="empty">Answer some questions and their review schedule shows up here.</div>'; return; }
  const names = ['Today', 'Tmrw', ...[2, 3, 4, 5, 6].map(i => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(t0.getDay() + i) % 7])];
  box.innerHTML = `<div class="forecast">${bins.map((n, i) => `<div class="fb"><div style="height:${Math.max(4, n / max * 100)}%" title="${n} due"></div><span>${names[i]}</span></div>`).join('')}</div>
    <div class="stat-legend"><span>${bins[0]} due today${overdue ? ` (${overdue} overdue)` : ''}</span><span>${bins.reduce((a, b) => a + b, 0)} this week · spaced by how well you knew each one</span></div>`;
}
function renderCalibration() {
  const r = calibration(), box = $('calibCard'), total = r.reduce((a, b) => a + b.n, 0);
  if (total < 10) { box.innerHTML = `<div class="empty">${settings.confidence ? 'Rate your confidence on a few more answers to see how well-calibrated you are.' : 'Turn on the confidence check in More → Study settings to measure calibration.'}</div>`; return; }
  const target = [0.4, 0.7, 0.92];
  box.innerHTML = r.map((x, i) => {
    const p = x.n ? x.c / x.n : 0;
    return `<div class="calib-row"><span class="n">${ic(CONF_IC[i])}${CONF_LABEL[i]}</span><span class="bar"><div style="width:${p * 100}%;background:${i === 2 && p < 0.8 ? 'var(--bad)' : 'var(--accent)'}"></div><span class="tgt" style="left:${target[i] * 100}%"></span></span><span class="p">${x.n ? Math.round(p * 100) + '%' : '–'} · n=${x.n}</span></div>`;
  }).join('') + verdictLine(r);
}
function verdictLine(r) {
  const c = r[2], g = r[0];
  const parts = [];
  if (c.n >= 5) { const p = c.c / c.n; parts.push(p < 0.8 ? `When you feel certain you are right only ${Math.round(p * 100)}% of the time — <b>overconfident</b>. Those confident misses are misconceptions: read the explanation slowly and write a note.` : `When you feel certain you are right ${Math.round(p * 100)}% of the time — well calibrated.`); }
  if (g.n >= 5) { const p = g.c / g.n; parts.push(p > 0.55 ? `Your "guesses" land ${Math.round(p * 100)}% — you know more than you think; trust your first instinct.` : `Guesses land ${Math.round(p * 100)}%, about what chance predicts.`); }
  return parts.length ? `<div class="verdict-line">${parts.join(' ')}</div>` : '';
}
function renderMastery() {
  const rows = domainStats().sort((a, b) => (a.at ? a.lo : 2) - (b.at ? b.lo : 2));
  const box = $('masteryList'); box.innerHTML = '';
  if (!rows.some(r => r.at)) { box.innerHTML = '<div class="empty">No answers yet — category accuracy will show up here.</div>'; return; }
  rows.forEach(r => {
    const row = el('div', 'mastery-row');
    const p = r.at ? Math.round(r.pct * 100) : null, low = r.at && r.at < 8;
    const color = p === null ? 'var(--surface3)' : p >= 70 ? 'var(--good)' : p >= 50 ? 'var(--gold)' : 'var(--bad)';
    row.innerHTML = `<div class="mastery-head"><span class="n"></span><span class="p"></span><button class="go">Practice</button></div>
      <div class="c" style="color:var(--muted);font-size:0.74rem;margin:-4px 0 6px;font-variant-numeric:tabular-nums"></div>
      <div class="mbar"><div style="width:${p ?? 0}%;background:${color};opacity:${low ? 0.55 : 1}"></div>${r.at ? `<span class="ci" style="left:${(r.lo * 100).toFixed(1)}%;width:${((r.hi - r.lo) * 100).toFixed(1)}%"></span>` : ''}</div>`;
    row.querySelector('.n').textContent = r.d;
    row.querySelector('.c').textContent = `${r.seen}/${r.total} seen · n=${r.at}${low ? ' · low data' : ''}`;
    row.querySelector('.p').textContent = p === null ? '—' : p + '%';
    row.querySelector('.go').onclick = () => startDomain(r.d);
    box.append(row);
  });
  box.append(Object.assign(el('div', 'stat-legend'), { innerHTML: '<span>shaded band = 95% confidence interval (Wilson)</span><span>sorted by the pessimistic bound</span>' }));
}
function renderBlueprint() {
  const box = $('blueprintCard'), rows = blueprintStats();
  if (!rows.length || !QUESTIONS.some(q => q.b)) { box.innerHTML = '<div class="empty">Official blueprint categories are available for forms listed in exam-meta.js.</div>'; return; }
  box.innerHTML = '';
  const bw = blueprintWeighted();
  if (bw) { const head = el('div', 'kv'); head.style.marginBottom = '10px'; head.innerHTML = `<span class="k">Blueprint-weighted accuracy</span><span class="v">${Math.round(bw.pct * 100)}%</span><span class="k">Covers</span><span class="v">${bw.covered}% of the exam weight</span>`; box.append(head); }
  rows.sort((a, b) => b.w - a.w).forEach(r => {
    const row = el('div', 'mastery-row');
    const p = r.at ? Math.round(r.pct * 100) : null, low = r.at && r.at < 8;
    const color = p === null ? 'var(--surface3)' : p >= 70 ? 'var(--good)' : p >= 50 ? 'var(--gold)' : 'var(--bad)';
    row.innerHTML = `<div class="mastery-head"><span class="n"></span><span class="p"></span><button class="go">Practice</button></div>
      <div class="c" style="color:var(--muted);font-size:0.74rem;margin:-4px 0 6px;font-variant-numeric:tabular-nums"></div>
      <div class="mbar"><div style="width:${p ?? 0}%;background:${color};opacity:${low ? 0.55 : 1}"></div>${r.at ? `<span class="ci" style="left:${(r.lo * 100).toFixed(1)}%;width:${((r.hi - r.lo) * 100).toFixed(1)}%"></span>` : ''}</div>`;
    row.querySelector('.n').textContent = `${r.b} · ${r.w}% of exam`;
    row.querySelector('.c').textContent = `${r.seen}/${r.total} seen · n=${r.at}${low ? ' · low data' : ''}`;
    row.querySelector('.p').textContent = p === null ? '—' : p + '%';
    row.querySelector('.go').onclick = () => startDomain(r.b);
    box.append(row);
  });
  box.append(Object.assign(el('div', 'stat-legend'), { innerHTML: '<span>ABFM blueprint weights; items categorised from the ITE handbooks</span><span>band = 95% CI</span>' }));
}
function renderSims() {
  const box = $('simCard'), sims = history().filter(h => h.form);
  if (!sims.length) { box.innerHTML = `<div class="empty">Take a Full ITE (Home → Full ITE) to get an official 200–800 scaled score and PGY comparisons.</div>`; return; }
  box.innerHTML = '';
  sims.slice(0, 10).forEach(rec => {
    const b = el('button', 'hist-item');
    const ym = yearMeta(rec.form);
    const sc = rec.scaled ?? null;
    b.innerHTML = `<span class="pct" style="width:56px;color:${sc === null ? 'var(--muted)' : sc >= META.reassuringScore ? 'var(--good)' : sc >= META.minimumPassingScore ? 'var(--gold)' : 'var(--bad)'}">${sc === null ? pct(rec.score, rec.n) + '%' : sc}</span><span class="lb"></span><span class="dt">${fmtDate(rec.t)}</span>`;
    b.querySelector('.lb').textContent = `ITE ${rec.form}` + (sc !== null && ym ? ` · raw ${rec.raw}/${ym.scored} · PGY-${settings.pgy || 3} mean ${Math.round(ym.norms[settings.pgy || 3].scaled)}` : ` · ${rec.score}/${rec.n}`);
    b.onclick = () => sheet(`Full ITE ${rec.form}`, body => { body.append(scaledCard(rec)); if (rec.ans) { const tabs = el('div', 'review-tabs'), list = el('div'); body.append(tabs, list); renderReview(tabs, list, rec, true); } });
    box.append(b);
  });
  box.append(Object.assign(el('div', 'stat-legend'), { innerHTML: `<span>passing standard ${META.minimumPassingScore} · ≥${META.reassuringScore} reassuring</span><span>SEM ≈ ${META.sem} points</span>` }));
}
function renderPace() {
  const a = allAttempts().filter(x => x.sec > 0).slice(0, 200), box = $('paceCard');
  if (a.length < 5) { box.innerHTML = '<div class="empty">Timing appears after a few answered questions.</div>'; return; }
  const mean = a.reduce((s, x) => s + x.sec, 0) / a.length;
  const exam = history().filter(h => h.mode === 'exam' && h.ms);
  const examMean = exam.length ? exam.reduce((s, h) => s + h.ms / 1000 / h.n, 0) / exam.length : null;
  const target = settings.secPerQ;
  box.innerHTML = `<div class="pace-row"><span class="big">${Math.round(mean)}s</span><span class="muted small">per question, last ${a.length} answers</span></div>
    <div class="kv" style="margin-top:10px"><span class="k">ITE allows about</span><span class="v">${target}s</span>${examMean !== null ? `<span class="k">Your pace in exam mode</span><span class="v" style="color:${examMean > target ? 'var(--bad)' : 'var(--good)'}">${Math.round(examMean)}s</span>` : ''}<span class="k">Timed blocks completed</span><span class="v">${exam.length}</span></div>
    <div class="verdict-line">${mean > target * 1.3 ? 'Tutor mode is slower by design (reading explanations). Use Timed blocks to practise pacing.' : 'You are comfortably inside exam pace.'}</div>`;
}
function renderHistory() {
  const h = history().slice(0, 30), box = $('historyList'); box.innerHTML = '';
  if (!h.length) { box.innerHTML = '<div class="empty">No sessions yet.</div>'; return; }
  h.forEach(rec => {
    const b = el('button', 'hist-item');
    const p = pct(rec.score, rec.n);
    b.innerHTML = `<span class="pct" style="color:${p >= 70 ? 'var(--good)' : p >= 50 ? 'var(--gold)' : 'var(--bad)'}">${p}%</span><span class="lb"></span>${rec.mode === 'exam' ? '<span class="md">EXAM</span>' : ''}<span class="dt">${rec.n} q · ${fmtDate(rec.t)}</span>`;
    b.querySelector('.lb').textContent = rec.label;
    b.onclick = () => sheet(`${rec.label} · ${p}%`, body => {
      body.append(Object.assign(el('p', 'sub'), { textContent: `${rec.score}/${rec.n} · ${new Date(rec.t).toLocaleString()}${rec.ms ? ' · ' + fmtDur(rec.ms) : ''}` }));
      if (rec.ans) { const tabs = el('div', 'review-tabs'), list = el('div'); body.append(tabs, list); renderReview(tabs, list, rec, true); }
      else body.append(el('div', 'empty', 'Per-question detail is not stored for this older session.'));
    });
    box.append(b);
  });
}

/* ---------------- more: settings, backup, about ---------------- */
function buildMoreUI() {
  $('exportBtn').addEventListener('click', () => doBackup().then(ok => ok && renderMore()));
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', onImportFile);
  $('resetBtn').addEventListener('click', async () => {
    if (!(await dialog({ title: 'Reset all progress?', msg: 'Deletes every answer, note, flag and session on this device. Back up first if you might want it later.', ok: 'Delete everything', danger: true }))) return;
    if (!(await dialog({ title: 'Really delete?', msg: 'This cannot be undone.', ok: 'Yes, delete', danger: true }))) return;
    store.set('snapshot.undo', { t: now(), label: 'before reset', qstats: stats(), history: history() });
    store.del('qstats'); store.del('history'); store.del('session'); store.set('sinceBackup', 0);
    STATS = null; renderMore(); toast('Progress reset. Undo is available under Restore for a while.');
  });
  $('signoutBtn').addEventListener('click', async () => {
    if (await dialog({ title: 'Sign out?', msg: 'You will need the password to unlock again. Your progress stays on this device.', ok: 'Sign out' })) { store.del('key'); location.reload(); }
  });
  $('restoreSnapBtn').addEventListener('click', openRestore);
  $('introBtn').addEventListener('click', showIntro);
}
function renderMore() {
  const lb = store.get('lastBackup', null), since = store.get('sinceBackup', 0);
  $('backupStatus').textContent = lb ? `Last backup ${agoDays(lb)} (${fmtDate(lb)}) · ${since} answer${since === 1 ? '' : 's'} since.` : `Never backed up · ${overall().attempts} answers at risk.`;
  $('backupCard').classList.toggle('warn', backupDue());
  renderSettings();
  renderAbout();
  const snaps = listSnapshots();
  $('restoreSnapBtn').classList.toggle('hidden', !snaps.length);
  $('restoreSnapBtn').textContent = `Restore a snapshot (${snaps.length})`;
}
function settingRow(t, d, control) { const r = el('div', 'setting'); const l = el('div', 'l'); l.append(el('div', 't', t), el('div', 'd', d)); r.append(l, control); return r; }
function switchCtl(key, onChange) {
  const b = el('button', 'switch' + (settings[key] ? ' on' : '')); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', !!settings[key]);
  b.onclick = () => { settings[key] = !settings[key]; b.classList.toggle('on', settings[key]); b.setAttribute('aria-checked', settings[key]); saveSettings(); onChange && onChange(); };
  return b;
}
function selectCtl(key, options, onChange) {
  const s = el('select'); options.forEach(([v, label]) => s.append(new Option(label, v)));
  s.value = String(settings[key]);
  s.onchange = () => { const v = s.value; settings[key] = isNaN(+v) || v === '' ? v : +v; saveSettings(); onChange && onChange(); };
  return s;
}
function renderSettings() {
  const box = $('settingsCard'); box.innerHTML = '';
  box.append(
    confStyleRow(),
    settingRow('Auto-advance after correct', 'Skip the Next tap when you get it right (1.4 s pause).', switchCtl('autoAdvance')),
    settingRow('Daily goal', 'Questions per day for the streak ring.', selectCtl('dailyGoal', [[10, '10'], [20, '20'], [30, '30'], [40, '40'], [60, '60'], [100, '100']])),
    settingRow('Smart session size', 'Questions in a Study-now session.', selectCtl('smartSize', [[10, '10'], [15, '15'], [20, '20'], [30, '30'], [40, '40']])),
    settingRow('Exam pace', 'Seconds per question in timed blocks. The FMCE allows 95 min per 75 questions (76 s).', selectCtl('secPerQ', [[60, '60 s'], [72, '72 s'], [76, '76 s (FMCE)'], [90, '90 s'], [120, '120 s']])),
    settingRow('Training year', 'Highlights your PGY in national comparisons.', selectCtl('pgy', [[0, 'Not set'], [1, 'PGY-1'], [2, 'PGY-2'], [3, 'PGY-3']])),
    settingRow('Skip questions most residents get right', skipEasyDesc(), selectCtl('skipEasy', [[-1, 'Off'], [0, `Easiest (${easyCount(0)})`], [150, `Easy (${easyCount(150)})`], [300, `Easier half (${easyCount(300)})`]], () => { settings.skipEasySet = true; saveSettings(); renderSettings(); })),
    hideFlaggedRow(),
    settingRow('Include items ABFM removed from scoring', 'Off keeps the few ambiguous items (deleted for content reasons) out of new sessions. They stay in Browse.', switchCtl('includeDeleted')),
    settingRow('Show countdown in timed blocks', 'Off shows answered count instead of the clock.', switchCtl('showTimer')),
    settingRow('Backup reminder', 'Nudge after sessions when a backup is overdue.', selectCtl('backupEvery', [[0, 'Off'], [1, 'Daily'], [3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks']])),
    settingRow('Show answers in Browse', 'Off hides the answer until you tap Reveal, so browsing is still retrieval practice.', switchCtl('revealInBrowse')),
  );
  const date = el('input'); date.type = 'date'; date.value = settings.examDate || '';
  date.onchange = () => { settings.examDate = date.value; saveSettings(); };
  box.append(settingRow('ITE date', 'Shows a countdown and a per-day plan on Home.', date));
  renderAppearance();
}
function segCtl(key, options, after) {
  const seg = el('div', 'seg');
  options.forEach(([v, label, icon]) => {
    const b = el('button', (settings[key] === v ? 'on' : '') + (icon ? ' no-check' : ''));
    b.innerHTML = (icon ? `<span aria-hidden="true" class="ms${settings[key] === v ? ' fill' : ''}">${icon}</span>` : '') + esc(label);
    b.setAttribute('aria-pressed', settings[key] === v);
    b.onclick = () => { settings[key] = v; saveSettings(); renderAppearance(); after && after(); };
    seg.append(b);
  });
  return seg;
}
function renderAppearance() {
  const ap = $('appearanceCard'); ap.innerHTML = '';
  const theme = segCtl('theme', [['auto', 'Auto', 'brightness_auto'], ['light', 'Light', 'light_mode'], ['dark', 'Dark', 'dark_mode']]);
  const icons = segCtl('icons', [['icons', 'Icons'], ['emoji', 'Emoji']]);
  const size = el('div', 'seg');
  [[0.9, 'A'], [1, 'A'], [1.12, 'A'], [1.25, 'A']].forEach(([v, l], i) => {
    const b = el('button', settings.textSize === v ? 'on no-check' : 'no-check', l); b.style.fontSize = (0.75 + i * 0.12) + 'rem';
    b.setAttribute('aria-label', ['Small', 'Default', 'Large', 'Largest'][i] + ' text');
    b.onclick = () => { settings.textSize = v; saveSettings(); renderAppearance(); }; size.append(b);
  });
  const colorRow = settingRow('Colour', 'The whole palette, light and dark, is generated from this colour.', el('span'));
  colorRow.classList.add('stacked'); colorRow.lastChild.remove(); colorRow.append(swatchPicker());
  ap.append(settingRow('Theme', 'Auto follows your device.', theme), colorRow,
    settingRow('Icons', 'Material icons or the original emoji.', icons), settingRow('Text size', '', size));
}
/* M3-style colour picker: each swatch previews primary / secondary / tertiary for the current mode. */
function swatchPicker() {
  const wrap = el('div', 'swatches');
  const cur = (settings.seed || HiteTheme.DEFAULT_SEED).toLowerCase();
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const paint = (sw, seed) => {
    const sc = HiteTheme.scheme(seed)[dark ? 'dark' : 'light'];
    sw.querySelector('.sw-a').style.background = sc.primary;
    sw.querySelector('.sw-b').style.background = sc['secondary-container'];
    sw.querySelector('.sw-c').style.background = sc['tertiary-container'];
  };
  const choose = seed => { settings.seed = seed; saveSettings(); renderAppearance(); };
  let presetHit = false;
  HiteTheme.PRESETS.forEach(([name, seed]) => {
    const on = seed.toLowerCase() === cur; presetHit = presetHit || on;
    const sw = el('button', 'swatch' + (on ? ' on' : ''));
    sw.innerHTML = '<span class="sw-a"></span><span class="sw-b"></span><span class="sw-c"></span><span class="ms" aria-hidden="true">check</span>';
    sw.title = name; sw.setAttribute('aria-label', name + ' colour'); sw.setAttribute('aria-pressed', on);
    paint(sw, seed); sw.onclick = () => choose(seed);
    wrap.append(sw);
  });
  const custom = el('label', 'swatch custom' + (presetHit ? '' : ' on'));
  custom.title = 'Pick any colour';
  custom.innerHTML = '<span class="sw-a"></span><span class="sw-b"></span><span class="sw-c"></span><span class="ms" aria-hidden="true">check</span><span class="ms add" aria-hidden="true">palette</span><input type="color" aria-label="Pick any colour">';
  const input = custom.querySelector('input'); input.value = cur;
  if (!presetHit) paint(custom, cur); else custom.querySelectorAll('.sw-a,.sw-b,.sw-c').forEach(e => e.style.background = 'transparent');
  let raf = 0;
  input.addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => HiteTheme.apply(input.value)); });
  input.addEventListener('change', () => choose(input.value.toLowerCase()));
  wrap.append(custom);
  return wrap;
}
function confStyleRow() {
  const seg = el('div', 'seg wrap');
  [['zones', '3 zones'], ['buttons', 'Buttons'], ['off', 'Off']].forEach(([v, label]) => {
    const b = el('button', settings.confStyle === v ? 'on' : '', label);
    b.onclick = () => { settings.confStyle = v; settings.confidence = v !== 'off'; saveSettings(); renderSettings(); };
    seg.append(b);
  });
  const r = settingRow('Confidence rating', '3 zones: tap the left (guess), middle (shaky) or right (confident) part of an answer, one tap. Buttons: choose an answer, then rate it. Ratings power calibration and smarter scheduling.', el('span'));
  r.classList.add('stacked'); r.lastChild.remove(); r.append(seg);
  return r;
}
function hideFlaggedRow() {
  const years = YEARS;
  const row = el('div', 'chip-row');
  years.forEach(y => {
    const n = QUESTIONS.filter(q => q.y === y && q.ai && q.ai.s === 'outdated').length;
    const on = (settings.hideFlaggedYears || []).includes(y);
    const c = el('button', 'chip' + (on ? ' on' : '')); c.textContent = `${y}`; c.append(el('span', 'n', `${n}`));
    c.setAttribute('aria-pressed', on);
    c.onclick = () => { const set = new Set(settings.hideFlaggedYears || []); on ? set.delete(y) : set.add(y); settings.hideFlaggedYears = [...set].sort(); settings.hideFlaggedSet = true; saveSettings(); renderSettings(); };
    row.append(c);
  });
  const r = settingRow('Hide questions flagged as outdated', 'An AI review flagged questions whose keyed answer may no longer match current guidance. Selected years are hidden (default: 2022 and earlier); other years show them with the reason. Numbers are flagged counts.', el('span'));
  r.classList.add('stacked'); r.lastChild.remove(); r.append(row);
  return r;
}
const easyCount = t => QUESTIONS.filter(q => q.df !== null && q.df <= t).length;
function skipEasyDesc() {
  const rated = QUESTIONS.filter(q => q.df !== null), years = [...new Set(rated.map(q => q.y))].join(', ');
  return `Uses ABFM's national difficulty for each question (${rated.length} rated so far: ${years || 'none'}). Skipped questions stay in Browse, Full ITE and your missed-question reviews.`;
}
function renderAbout() {
  $('aboutCard').innerHTML = `
    <p>ITE practice built on what the learning-science evidence supports, with as few taps as possible between you and the next question.</p>
    <ul>
      <li><b>Retrieval practice.</b> Answering from memory beats re-reading (Roediger &amp; Karpicke 2006; Dunlosky et al. 2013).</li>
      <li><b>Spacing.</b> SM‑2‑style scheduling: longer gaps when you know it, back tomorrow when you miss it (Cepeda et al. 2006). "Study now" takes due items first.</li>
      <li><b>Interleaving.</b> Sessions mix categories, which sharpens discrimination between similar presentations (Rohrer &amp; Taylor 2007; Kornell &amp; Bjork 2008).</li>
      <li><b>Metacognition.</b> Rating confidence before the answer exposes overconfidence and keeps lucky guesses from counting as learned (Koriat &amp; Bjork 2005; Butler, Karpicke &amp; Roediger 2008). Confident misses come back first.</li>
      <li><b>Feedback.</b> The critique right after each item (Butler, Karpicke &amp; Roediger 2007), plus a one-line note in your own words.</li>
      <li><b>Analytics.</b> First-try accuracy, 7-day retention and Wilson intervals, so small samples don't mislead.</li>
      <li><b>Exam data.</b> Blueprint categories, items removed from scoring, raw-to-scaled conversion and PGY means are from the ABFM ITE Score Results Handbooks (${Object.keys(META.years).join(', ') || 'none loaded'}); weights and timing from the FMCE Information Booklet. Area sub-scores are hypothesis-generating, as ABFM cautions.</li>
    </ul>
    ${BLUEPRINTS.length ? `<div class="kv" style="margin-top:12px">${BLUEPRINTS.map(b => `<span class="k">${b}</span><span class="v">${META.blueprint[b]}%</span>`).join('')}</div>` : ''}
    <p class="cite" style="margin-top:12px">Bank: ABFM ITE ${YEARS[0]}–${YEARS[YEARS.length - 1]}, ${QUESTIONS.length} items. Category labels are keyword-derived and approximate. Hite is not affiliated with the ABFM.</p>`;
  $('aboutFoot').innerHTML = `Hite v${APP_VERSION.replace('__VERSION__', 'dev')} · progress is stored only on this device<br>Made by <a href="https://github.com/robbie-med" target="_blank" rel="noopener">robbie-med</a> · <a href="https://github.com/robbie-med/Hite" target="_blank" rel="noopener">open source (MIT)</a><br>Built for family medicine residents. Thanks to my colleague <b>NR</b> for the inspiration.<br>Not affiliated with the ABFM. Questions and critiques © ABFM. The ABFM probably wouldn't like this.<br>S.D.G.`;
}

/* ---------------- backup / import / snapshots ---------------- */
function backupDue() {
  if (!settings.backupEvery) return false;
  const since = store.get('sinceBackup', 0); if (since < 10) return false;
  const lb = store.get('lastBackup', null), snooze = store.get('backupSnoozed', 0);
  if (now() - snooze < DAY) return false;
  return !lb || now() - lb >= settings.backupEvery * DAY;
}
function exportPayload() {
  return { app: 'hite', v: 2, exported: now(), version: APP_VERSION, qstats: stats(), history: history(), settings };
}
async function doBackup() {
  const json = JSON.stringify(exportPayload());
  const name = `hite-ite-backup-${new Date().toISOString().slice(0, 10)}.json`;
  let ok = false;
  try {
    const file = new File([json], name, { type: 'application/json' });
    const mobile = /iP(hone|ad|od)|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Hite progress backup' });
      ok = true;
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ok = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false;   // user dismissed the share sheet
    try { await navigator.clipboard.writeText(json); toast('Could not open the share sheet — backup copied to clipboard instead. Paste it into Notes.'); ok = true; }
    catch { toast('Backup failed. Try again from a browser tab.'); }
  }
  if (ok) { store.set('lastBackup', now()); store.set('sinceBackup', 0); toast('Backed up. Keep that file somewhere safe (Files, iCloud, email to yourself).'); }
  return ok;
}
function renderBackupNudge() {
  const box = $('backupNudge'); box.innerHTML = '';
  if (!backupDue()) return;
  const lb = store.get('lastBackup', null);
  const c = el('div', 'card warn backup-card');
  c.innerHTML = `<h3>Back up your progress?</h3><div class="sub">${lb ? `Last backup ${agoDays(lb)}` : 'You have never backed up'} · ${store.get('sinceBackup', 0)} answers since. Everything is stored only on this device — a new phone, a cleared browser or a reinstall would lose it.</div>
    <div class="actions"><button class="btn sm" id="bnNow">Back up now</button><button class="btn sm danger" style="color:inherit" id="bnLater">Not now</button></div>`;
  c.querySelector('#bnNow').onclick = () => doBackup().then(ok => ok && c.remove());
  c.querySelector('#bnLater').onclick = () => { store.set('backupSnoozed', now()); c.remove(); };
  box.append(c);
}
async function onImportFile(e) {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch { return alertBox('Import failed', 'That file is not readable JSON.'); }
  if (!d || typeof d.qstats !== 'object' || !Array.isArray(d.history)) return alertBox('Import failed', 'That file does not look like a Hite / ITE Quiz backup.');
  const inQ = Object.keys(d.qstats).length, inH = d.history.length, haveQ = Object.keys(stats()).length;
  sheet('Import backup', body => {
    body.append(Object.assign(el('p', 'sub'), { textContent: `The file has ${inQ} question records and ${inH} sessions${d.exported ? `, exported ${new Date(d.exported).toLocaleDateString()}` : ''}. This device has ${haveQ} question records and ${history().length} sessions.` }));
    const merge = el('button', 'btn', 'Merge into this device (recommended)'); merge.style.marginBottom = '10px';
    merge.onclick = () => { closeSheet(); doImport(d, 'merge'); };
    const replace = el('button', 'btn danger', 'Replace everything on this device');
    replace.onclick = async () => { closeSheet(); if (await dialog({ title: 'Replace all progress?', msg: 'Current progress on this device will be overwritten by the file.', ok: 'Replace', danger: true })) doImport(d, 'replace'); };
    const note = el('p', 'sub'); note.style.marginTop = '12px'; note.textContent = 'Merge keeps every attempt from both, so combining a phone and a laptop never loses anything.';
    body.append(merge, replace, note);
  });
}
function doImport(d, mode) {
  store.set('snapshot.undo', { t: now(), label: 'before import', qstats: stats(), history: history() });
  if (mode === 'replace') {
    store.set('qstats', d.qstats); store.set('history', d.history);
  } else {
    const st = stats(), H = history();
    for (const k in d.qstats) {
      const inc = d.qstats[k], cur = st[k];
      if (!cur) { st[k] = inc; continue; }
      const seen = new Set((cur.h || []).map(a => a[0]));
      const merged = [...(cur.h || []), ...((inc.h || []).filter(a => !seen.has(a[0])))].sort((a, b) => a[0] - b[0]).slice(-30);
      const newer = (inc.l || 0) > (cur.l || 0) ? inc : cur;
      // Counts: never lower than either side or than the merged log (log is capped at 30, so max() is the safe choice).
      cur.s = Math.max(cur.s || 0, inc.s || 0, merged.length);
      cur.c = Math.max(cur.c || 0, inc.c || 0, merged.filter(a => a[1]).length);
      Object.assign(cur, { lc: newer.lc, l: newer.l, lcf: newer.lcf, iv: newer.iv, ef: newer.ef, due: newer.due, st: newer.st, h: merged.length ? merged : undefined });
      if (cur.fa === undefined && inc.fa !== undefined) cur.fa = inc.fa;
      if (inc.fl) cur.fl = 1;
      if (inc.nt && !cur.nt) cur.nt = inc.nt; else if (inc.nt && cur.nt && inc.nt !== cur.nt) cur.nt = cur.nt + '\n' + inc.nt;
      if (cur.h === undefined) delete cur.h;
    }
    const have = new Set(H.map(h => h.t));
    d.history.forEach(h => { if (!have.has(h.t)) H.push(h); });
    H.sort((a, b) => b.t - a.t); if (H.length > 300) H.length = 300;
    store.set('qstats', st); store.set('history', H);
  }
  if (d.settings && mode === 'replace') { settings = Object.assign({}, DEFAULTS, d.settings); saveSettings(); }
  STATS = null; migrate();   // backfill scheduling fields on any v1 records
  renderMore();
  toast(mode === 'merge' ? 'Merged. Nothing was lost from either side.' : 'Imported.');
}
function listSnapshots() {
  return ['snapshot.undo', 'snapshot.v1', 'snapshot.auto'].map(k => ({ k, s: store.get(k, null) })).filter(x => x.s && x.s.qstats);
}
function autoSnapshot() {
  const last = store.get('snapshot.auto', null);
  if (last && now() - last.t < DAY) return;
  const hist = history().map(h => { const c = Object.assign({}, h); delete c.ans; return c; });
  store.set('snapshot.auto', { t: now(), label: 'daily automatic', qstats: stats(), history: hist });
}
function openRestore() {
  const snaps = listSnapshots(); if (!snaps.length) return;
  sheet('Restore a snapshot', body => {
    body.append(Object.assign(el('p', 'sub'), { textContent: 'Snapshots are safety copies kept on this device. Restoring replaces current progress with the copy (the current state is saved as an undo snapshot first).' }));
    snaps.forEach(({ k, s }) => {
      const n = Object.keys(s.qstats).filter(x => attempted(s.qstats[x])).length;
      const c = el('div', 'card'); c.style.marginBottom = '10px';
      c.innerHTML = `<div class="row between"><div><h3>${esc(s.label || k)}</h3><div class="sub">${new Date(s.t).toLocaleString()} · ${n} questions · ${(s.history || []).length} sessions</div></div><button class="btn sm">Restore</button></div>`;
      c.querySelector('button').onclick = async () => {
        closeSheet();
        if (!(await dialog({ title: 'Restore this snapshot?', msg: `Progress will be set back to ${new Date(s.t).toLocaleString()}.`, ok: 'Restore', danger: true }))) return;
        const undo = { t: now(), label: 'before restore', qstats: stats(), history: history() };
        store.set('qstats', s.qstats); store.set('history', s.history || []); store.set('snapshot.undo', undo);
        STATS = null; migrate();
        renderMore(); toast('Snapshot restored.');
      };
      body.append(c);
    });
  });
}

/* ---------------- service worker / updates ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const seen = store.get('versions', []);
  if (!seen.includes(APP_VERSION)) store.set('versions', [APP_VERSION, ...seen].slice(0, 20));
  let hadController = !!sw.controller;
  // Register this build's own script URL ("?v=" keeps CDN copies of older sw.js out of it).
  sw.register('sw.js?v=' + APP_VERSION).then(reg => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });   // left waiting by an older build
    checkLatest();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { reg.update().catch(() => {}); checkLatest(); } });
  }).catch(() => {});
  sw.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }   // first install, nothing to refresh
    if (quiz) { saveSession(); showUpdateBar(); } else location.reload();
  });
}
/* Cloudflare caches sw.js for hours, so the browser's own update check can see a stale
   copy. Read the newest version straight from the origin (unique URL, no cache) and
   install that exact build. Never goes back to a version this device has run. */
let checkingLatest = false;
async function checkLatest() {
  if (checkingLatest || APP_VERSION.includes('__')) return;
  checkingLatest = true;
  try {
    const r = await fetch('sw.js?t=' + Date.now(), { cache: 'no-store' });
    // Written so build.py's version stamping (which rewrites "const VERSION = '8ef223cab4b8'") can't touch it.
    const m = r.ok && (await r.text()).match(/VERSION\s*=\s*'([0-9a-f]{12})'/);
    if (m && m[1] && m[1] !== APP_VERSION && !store.get('versions', []).includes(m[1])) await navigator.serviceWorker.register('sw.js?v=' + m[1]);
  } catch {}
  checkingLatest = false;
}
function showUpdateBar() {
  const host = $('updateHost'); if (host.childElementCount) return;
  const bar = el('div', 'update-bar');
  bar.innerHTML = `<span>Update ready · your progress is kept</span><button id="upNow">Reload</button><button class="later" id="upLater">Later</button>`;
  bar.querySelector('#upNow').onclick = () => { if (quiz) saveSession(); location.reload(); };
  bar.querySelector('#upLater').onclick = () => bar.remove();
  host.append(bar);
}

/* ---------------- resilience ---------------- */
let errorShown = false;
window.addEventListener('error', e => { if (errorShown) return; errorShown = true; console.error(e.error || e.message); toast('Something went wrong — your progress is safe.', 'Reload', () => location.reload()); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && quiz) saveSession(); });
window.addEventListener('pagehide', () => { if (quiz) saveSession(); });

boot();

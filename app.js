/* Aside — composer logic.
   Fully static: no backend, no network requests, no dependencies.
   Captures the source, estimates an effort split, renders a tiny email badge,
   and saves/loads a private JSON record. Every loaded value is rendered with
   textContent only — never innerHTML — so a hostile JSON file stays inert. */

'use strict';

// ======================================================================
//  CONFIG — set this once
// ======================================================================
//
//  LEARN_MORE_URL is the full URL the badge's "Learn more" link points at —
//  your hosted About page.
//
//  This default can be overridden in the UI ("Learn more link"), so anyone using
//  a hosted copy can point their badges at their own About page without editing
//  code. That override is saved per-browser (localStorage, no network).
//
//  Resolution order:
//    1. UI override (if the user typed one)         — per-browser
//    2. LEARN_MORE_URL constant below                — the shipped default
//    3. auto-derived from the address bar (http/s)   — if the constant is blank
//    4. placeholder (file:// only)                   — clearly labelled, still copyable
//
//  If you fork this, set LEARN_MORE_URL to your own About page (or leave it
//  blank to auto-derive on http(s)).
//
const LEARN_MORE_URL = 'https://ai-writing-transparency.netlify.app/about.html'; // default; users can override in the UI
const PLACEHOLDER_URL = 'https://YOUR-SITE.example/about.html'; // shown only on file:// when the constant is blank and no override
const BASE_KEY = 'aside.learnMoreUrl';

function storedUrl() {
  try { return (localStorage.getItem(BASE_KEY) || '').trim(); } catch { return ''; }
}
// the default, ignoring any per-browser override
function defaultLearnMore() {
  if (LEARN_MORE_URL) return LEARN_MORE_URL;
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const dir = location.pathname.replace(/\/[^/]*$/, ''); // strip the file name
    return location.origin + dir + '/about.html';
  }
  return PLACEHOLDER_URL;
}
function resolveLearnMore() { return { url: storedUrl() || defaultLearnMore() }; }
function aboutUrl() { return resolveLearnMore().url; }

// ======================================================================
//  tiny DOM helpers (textContent only — innerHTML is rejected)
// ======================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v; // safe by construction
    else if (k === 'html') throw new Error('innerHTML is not allowed');
    else node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid) node.appendChild(kid);
  return node;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast((label || 'Copied') + ' ✓'); }
  catch { toast('Copy failed — select the text and copy manually'); }
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ======================================================================
//  state
// ======================================================================
const state = {
  manualAi: false, // true once the slider is touched (or a JSON value is loaded)
  created: 0,      // preserved across edits; set on first save / from a loaded file
};

// element refs
let elOriginal, elResult, elAiLink, elNote, elAi, elContext, elBase;

function kind() { return $('input[name="kind"]:checked').value; }

// ======================================================================
//  effort estimate (transparent heuristic; uses raw lengths)
// ======================================================================
function estimate() {
  const k = kind();
  const inputLen = elOriginal.value.trim().length;
  const aiLen = elResult.value.trim().length;

  if (k === 'edit') {
    return { ai: 20, reason: 'You wrote the draft and the AI edited it, so most of the work is credited to you (~20% AI).' };
  }
  if (aiLen === 0) {
    return { ai: 50, reason: 'Add the AI output to estimate the split; until then this is a neutral guess.' };
  }
  const ratio = aiLen / Math.max(inputLen, 1);
  let ai;
  if (ratio >= 6) ai = 90;
  else if (ratio >= 3) ai = 78;
  else if (ratio >= 1.5) ai = 62;
  else if (ratio >= 0.8) ai = 45;
  else ai = 30;
  ai = Math.max(5, Math.min(95, ai));
  const reason = ratio >= 1.5
    ? `A short prompt (${inputLen} chars) expanded into a much longer output (${aiLen} chars), so most of the wording is the AI's (~${ai}% AI).`
    : `Your prompt (${inputLen} chars) was close to the output length (${aiLen} chars), so more of the wording is yours (~${ai}% AI).`;
  return { ai, reason };
}

// lightly / moderately / heavily
function band(ai) {
  if (ai <= 33) return 'Lightly';
  if (ai <= 66) return 'Moderately';
  return 'Heavily';
}

function refreshMeter() {
  let ai;
  if (state.manualAi) {
    ai = Number(elAi.value);
    $('#auto-badge').textContent = 'manual';
  } else {
    const est = estimate();
    ai = est.ai;
    elAi.value = String(ai);
    $('#auto-badge').textContent = 'auto';
  }
  const human = 100 - ai;
  $('#meter-human').style.width = human + '%';
  $('#meter-ai').style.width = ai + '%';
  $('#meter-human').textContent = human >= 12 ? human + '%' : '';
  $('#meter-ai').textContent = ai >= 12 ? ai + '%' : '';
  $('#legend-human').textContent = human + '%';
  $('#legend-ai').textContent = ai + '%';
}

// ======================================================================
//  the badge — two copy formats + a live preview
// ======================================================================
function aiPct() { return Math.max(0, Math.min(100, Number(elAi.value) || 0)); }
function badgeMode() { return $('input[name="badgemode"]:checked').value; } // 'compact' | 'detailed'

// e.g. "Lightly AI-assisted (~20%)"
function badgeLabel() {
  const ai = aiPct();
  return `${band(ai)} AI-assisted (~${ai}%)`;
}

// quick-pick context options. The four built-ins are always shown; the user can
// save their own, which persist in this browser only (localStorage, no network).
const DEFAULT_CHIPS = [
  'AI checked spelling, grammar, and wording.',
  'AI helped refine the wording and tone.',
  'AI drafted this from a prompt I wrote.',
  'AI helped research and summarize.',
];
const CHIPS_KEY = 'aside.contextOptions';
function getCustomChips() {
  try { const v = JSON.parse(localStorage.getItem(CHIPS_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function setCustomChips(arr) {
  try { localStorage.setItem(CHIPS_KEY, JSON.stringify(arr)); } catch {}
}

// remember the last badge style + stat toggle, so the page reopens the way you left it
const PREFS_KEY = 'aside.badgePrefs';
function getBadgePrefs() {
  try { const v = JSON.parse(localStorage.getItem(PREFS_KEY)); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}
function saveBadgePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ badgeMode: badgeMode(), showStats: showStats() })); } catch {}
}

// the context line for the detailed badge — user text, or a sensible default
function defaultContext() {
  return kind() === 'edit'
    ? 'AI checked spelling, grammar, and wording.'
    : 'AI drafted this from a prompt I wrote.';
}
function contextText() { return (elContext.value.trim() || defaultContext()); }

// optional comparison stat (detailed badge, line 3). Mode-aware:
//   edit  → how much of the sender's wording the AI changed (word-level diff)
//   prompt → how much a short prompt expanded into the result (word counts + factor)
function showStats() { return $('#f-stats').checked; }
function wordCount(text) { return (text.trim().match(/\S+/g) || []).length; }
function tokenize(text) { return (text.toLowerCase().match(/[a-z0-9']+/g) || []); }

// word-level Levenshtein distance, normalised by the longer text → "% changed".
// Inputs are capped so a pasted essay can't make this expensive.
function percentChanged(origText, resultText) {
  const a = tokenize(origText).slice(0, 1500);
  const b = tokenize(resultText).slice(0, 1500);
  if (!a.length && !b.length) return 0;
  const m = a.length, n = b.length;
  if (!m) return 100;
  if (!n) return 100;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return Math.round((prev[n] / Math.max(m, n)) * 100);
}

function fmtFactor(f) { return f >= 10 ? String(Math.round(f)) : String(Math.round(f * 10) / 10); }

function statsLine() {
  const o = wordCount(elOriginal.value), r = wordCount(elResult.value);
  if (kind() === 'edit') {
    if (!o && !r) return 'Add your draft and the result to compare.';
    return `AI revised ~${percentChanged(elOriginal.value, elResult.value)}% of my wording`;
  }
  // prompt mode → expansion from prompt to result
  if (!o || !r) return `${o}-word prompt → ${r} words`;
  const factor = r / o;
  if (factor >= 1.1) return `${o}-word prompt → ${r} words (~${fmtFactor(factor)}× expansion)`;
  return `${o}-word prompt → ${r} words`;
}

const STAR_COLOR = '#1f8a8a'; // keep in sync with --ai
const LINK_COLOR = '#2d4a7c'; // keep in sync with --human
const STAT_COLOR = '#8a8a82'; // muted, keep in sync with --muted
const FONT_STACK = '-apple-system,Segoe UI,Roboto,sans-serif';

// plain text — no em-dashes; compact is one line, detailed is a few lines
function badgeText() {
  const about = aboutUrl();
  const seeMore = `See how this was made: ${about}`;
  if (badgeMode() === 'detailed') {
    // with stats: "Learn more" rides on line 1, stats take line 3
    if (showStats()) {
      return `✶ ${badgeLabel()} · ${seeMore}\n${contextText()}\n${statsLine()}`;
    }
    return `✶ ${badgeLabel()}\n${contextText()}\n${seeMore}`;
  }
  return `✶ ${badgeLabel()} · ${seeMore}`;
}

// HTML — inline styles only, no <style>/JS. Dynamic pieces escaped.
function badgeHtml() {
  const label = escapeHtml(badgeLabel());
  const href = escapeHtml(aboutUrl());
  if (badgeMode() === 'detailed') {
    const ctx = escapeHtml(contextText());
    const link = `<a href="${href}" style="color:${LINK_COLOR};">Learn more</a>`;
    const open = `<div style="font-family:${FONT_STACK};font-size:13px;color:#4a4a45;line-height:1.5;">`;
    const star = `<span style="color:${STAR_COLOR};">✶</span>`;
    if (showStats()) {
      const stats = escapeHtml(statsLine());
      return open
        + `${star} ${label} · ${link}<br>`
        + `${ctx}<br>`
        + `<span style="color:${STAT_COLOR};">${stats}</span></div>`;
    }
    return open
      + `${star} ${label}<br>`
      + `${ctx}<br>`
      + `${link}</div>`;
  }
  return `<span style="font-family:${FONT_STACK};font-size:13px;color:#4a4a45;">`
    + `<span style="color:${STAR_COLOR};">✶</span> ${label} · `
    + `<a href="${href}" style="color:${LINK_COLOR};">Learn more</a></span>`;
}

function refreshBadge() {
  const ai = aiPct();
  const human = 100 - ai;
  const detailed = badgeMode() === 'detailed';

  // reveal the context field only in detailed mode
  $('#ctx-field').hidden = !detailed;

  // live preview — built with DOM nodes, mirrors the HTML copy version
  const stage = $('#badge-stage');
  stage.textContent = '';
  const line = el('span', { class: 'badge-line' + (detailed ? ' detailed' : '') });

  const firstLine = el('span');
  firstLine.appendChild(el('span', { class: 'star', text: '✶' }));
  firstLine.appendChild(document.createTextNode(' ' + badgeLabel() + ' '));
  // small gradient bar (preview only — not part of the copyable badge)
  const bar = el('span', { class: 'badge-bar', title: human + '% human / ' + ai + '% AI' });
  const bh = el('span', { class: 'human' }); bh.style.width = human + '%';
  const ba = el('span', { class: 'ai' }); ba.style.width = ai + '%';
  bar.appendChild(bh); bar.appendChild(ba);
  firstLine.appendChild(bar);
  line.appendChild(firstLine);

  const makeLink = () => el('a', { href: aboutUrl(), text: 'Learn more', rel: 'noreferrer' });
  if (detailed) {
    const withStats = showStats();
    if (withStats) {
      // Learn more rides on line 1 (like compact); stats take line 3
      firstLine.appendChild(document.createTextNode(' · '));
      firstLine.appendChild(makeLink());
    }
    line.appendChild(el('span', { class: 'ctx', text: contextText() })); // textContent — safe
    if (withStats) {
      line.appendChild(el('span', { class: 'stats', text: statsLine() })); // textContent — safe
    } else {
      line.appendChild(makeLink());
    }
  } else {
    firstLine.appendChild(document.createTextNode(' · '));
    firstLine.appendChild(makeLink());
  }
  stage.appendChild(line);

  // raw copy strings, for inspection
  $('#copy-text').textContent = badgeText();
  $('#copy-html').textContent = badgeHtml();
}

// render the quick-pick chips: built-ins (plain) then saved customs (removable)
function renderChips() {
  const wrap = $('#ctx-chips');
  wrap.textContent = '';
  DEFAULT_CHIPS.forEach((text) => {
    const b = el('button', { type: 'button', class: 'chip', text });
    b.addEventListener('click', () => { elContext.value = text; refreshBadge(); });
    wrap.appendChild(b);
  });
  getCustomChips().forEach((text, i) => {
    const chip = el('span', { class: 'chip chip-custom' });
    const t = el('button', { type: 'button', class: 'chip-text', text });
    t.addEventListener('click', () => { elContext.value = text; refreshBadge(); });
    const x = el('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove this saved option', text: '×' });
    x.addEventListener('click', () => {
      const arr = getCustomChips(); arr.splice(i, 1); setCustomChips(arr); renderChips();
    });
    chip.appendChild(t); chip.appendChild(x);
    wrap.appendChild(chip);
  });
}

function addCurrentAsChip() {
  const text = elContext.value.trim();
  if (!text) { toast('Type some context first'); return; }
  if (DEFAULT_CHIPS.includes(text) || getCustomChips().includes(text)) { toast('That option is already saved'); return; }
  const arr = getCustomChips();
  arr.push(text);
  setCustomChips(arr);
  renderChips();
  toast('Saved as an option ✓');
}

// ======================================================================
//  JSON record — save / load (the private archive)
// ======================================================================
function buildRecord() {
  return {
    app: 'aside',
    v: 1,
    kind: kind(),
    original: elOriginal.value,
    result: elResult.value,
    aiLink: elAiLink.value.trim(),
    ai: aiPct(),
    note: elNote.value,
    badgeMode: badgeMode(),
    context: elContext.value,
    showStats: showStats(),
    created: state.created || 0,
    updated: 0,
  };
}

function saveJson() {
  const now = Date.now();
  if (!state.created) state.created = now;
  const rec = buildRecord();
  rec.created = state.created;
  rec.updated = now;

  const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
  // date + time so saves never overwrite each other, e.g.
  // AI-Writing_Transparency_2026-06-27_16-30-45.json
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const a = el('a', { href: URL.createObjectURL(blob), download: `AI-Writing_Transparency_${stamp}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Saved JSON ✓');
}

function applyRecord(rec) {
  // validate untrusted input
  if (!rec || typeof rec !== 'object' || rec.app !== 'aside' || rec.v !== 1) {
    toast('Not an Aside file — nothing loaded');
    return false;
  }
  const k = rec.kind === 'edit' ? 'edit' : 'prompt';
  $(`input[name="kind"][value="${k}"]`).checked = true;

  // .value assignment is inert against markup; we never use innerHTML
  elOriginal.value = typeof rec.original === 'string' ? rec.original : '';
  elResult.value = typeof rec.result === 'string' ? rec.result : '';
  elAiLink.value = typeof rec.aiLink === 'string' ? rec.aiLink : '';
  elNote.value = typeof rec.note === 'string' ? rec.note : '';
  elContext.value = typeof rec.context === 'string' ? rec.context : '';
  const m = rec.badgeMode === 'detailed' ? 'detailed' : 'compact';
  $(`input[name="badgemode"][value="${m}"]`).checked = true;
  $('#f-stats').checked = !!rec.showStats;

  // restore the saved split exactly (lossless round-trip), mark manual so the
  // estimator doesn't overwrite it on the next render
  const ai = Math.max(0, Math.min(100, Number(rec.ai)));
  elAi.value = String(Number.isFinite(ai) ? ai : 50);
  state.manualAi = true;

  state.created = Number(rec.created) || 0;

  refreshOriginalLabel();
  refreshMeter();
  refreshBadge();
  return true;
}

function loadJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let rec;
    try { rec = JSON.parse(String(reader.result)); }
    catch { toast("Couldn't read that file — invalid JSON"); return; }
    if (applyRecord(rec)) toast('Loaded ✓');
  };
  reader.onerror = () => toast("Couldn't read that file");
  reader.readAsText(file);
}

// ======================================================================
//  wiring
// ======================================================================
function refreshOriginalLabel() {
  const isEdit = kind() === 'edit';
  $('#original-label').textContent = isEdit ? 'Your own draft' : 'The prompt you gave the AI';
  elOriginal.placeholder = isEdit ? 'Paste your own draft…' : 'Paste the prompt you wrote…';
}

function boot() {
  elOriginal = $('#f-original');
  elResult = $('#f-result');
  elAiLink = $('#f-ailink');
  elNote = $('#f-note');
  elAi = $('#f-ai');
  elContext = $('#f-context');
  elBase = $('#f-base');

  // source text → re-estimate (unless manual) and re-render the badge
  [elOriginal, elResult].forEach((node) => node.addEventListener('input', () => {
    if (!state.manualAi) refreshMeter();
    refreshBadge();
  }));

  $('#kind-toggle').addEventListener('change', () => {
    refreshOriginalLabel();
    if (!state.manualAi) refreshMeter();
    refreshBadge();
  });

  // slider always wins once touched
  elAi.addEventListener('input', () => { state.manualAi = true; refreshMeter(); refreshBadge(); });

  // badge mode + context
  $('#mode-toggle').addEventListener('change', () => { saveBadgePrefs(); refreshBadge(); });
  elContext.addEventListener('input', refreshBadge);
  $('#ctx-add').addEventListener('click', addCurrentAsChip);
  renderChips();

  // comparison-stat option (detailed badge)
  $('#f-stats').addEventListener('change', () => { saveBadgePrefs(); refreshBadge(); });

  // editable "Learn more" link (the full URL to your About page).
  // The reset control shows only when the value differs from the default.
  function updateResetVisibility() { $('#base-reset').hidden = elBase.value.trim() === defaultLearnMore(); }
  elBase.value = resolveLearnMore().url;
  updateResetVisibility();
  elBase.addEventListener('input', () => {
    const v = elBase.value.trim();
    try { v ? localStorage.setItem(BASE_KEY, v) : localStorage.removeItem(BASE_KEY); } catch {}
    updateResetVisibility();
    refreshBadge();
  });
  $('#base-reset').addEventListener('click', () => {
    try { localStorage.removeItem(BASE_KEY); } catch {}
    elBase.value = resolveLearnMore().url; // reverts to default / derived
    updateResetVisibility();
    refreshBadge();
  });

  // actions
  $('#copy-text-btn').addEventListener('click', () => copy(badgeText(), 'Badge (text) copied'));
  $('#copy-html-btn').addEventListener('click', () => copy(badgeHtml(), 'Badge (HTML) copied'));
  $('#save-btn').addEventListener('click', saveJson);
  $('#load-btn').addEventListener('click', () => $('#load-input').click());
  $('#load-input').addEventListener('change', (e) => {
    loadJson(e.target.files[0]);
    e.target.value = ''; // allow re-loading the same file
  });

  // restore the last-used badge style + stat toggle
  const prefs = getBadgePrefs();
  if (prefs.badgeMode === 'detailed' || prefs.badgeMode === 'compact') {
    $(`input[name="badgemode"][value="${prefs.badgeMode}"]`).checked = true;
  }
  if (typeof prefs.showStats === 'boolean') $('#f-stats').checked = prefs.showStats;

  // initial render
  refreshOriginalLabel();
  refreshMeter();
  refreshBadge();
}

document.addEventListener('DOMContentLoaded', boot);

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

// ----- HTML sanitiser ---------------------------------------------------
// Cleans formatted (pasted or loaded) HTML so it is safe to put in the DOM
// or on the clipboard. Parsing happens inside an inert <template>, so nothing
// runs during sanitising; we keep formatting tags but strip scripts, event
// handlers, and javascript: URLs. This preserves the "a hostile file stays
// inert" guarantee even though the AI-output box now holds HTML.
const KEEP_TAGS = new Set(['A','ABBR','B','BLOCKQUOTE','BR','CODE','DIV','EM','FONT','H1','H2','H3','H4','H5','H6','HR','I','IMG','LI','OL','P','PRE','S','SMALL','SPAN','STRIKE','STRONG','SUB','SUP','TABLE','TBODY','TD','TH','THEAD','TR','U','UL']);
const DROP_TAGS = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','BASE','NOSCRIPT','TITLE','HEAD','FORM','INPUT','BUTTON','SVG','MATH']);
const KEEP_ATTRS = new Set(['href','src','alt','title','style','color','face','size','align','width','height','colspan','rowspan','bgcolor','start','type']);

function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const all = [];
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) all.push(n);
  all.forEach((node) => {
    const tag = node.tagName;
    if (DROP_TAGS.has(tag)) { node.remove(); return; }
    if (!KEEP_TAGS.has(tag)) { // unknown tag: unwrap, keep its children/text
      while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if (name.startsWith('on') || !KEEP_ATTRS.has(name)) { node.removeAttribute(attr.name); return; }
      if ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(val) && !/^\s*data:image\//i.test(val)) {
        node.removeAttribute(attr.name);
      }
      if (name === 'style' && /(javascript:|expression\s*\(|behaviou?r\s*:|@import|url\s*\(\s*['"]?\s*javascript:)/i.test(val)) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return tpl.innerHTML;
}

// the AI-output box is rich (contenteditable): text for measuring, HTML for output
function resultText() { return (elResult.innerText || elResult.textContent || '').trim(); }
function resultHtml() { return sanitizeHtml(elResult.innerHTML); }

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
  const aiLen = resultText().length;

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
  const rText = resultText();
  const o = wordCount(elOriginal.value), r = wordCount(rText);
  if (kind() === 'edit') {
    if (!o && !r) return 'Add your draft and the result to compare.';
    return `AI revised ~${percentChanged(elOriginal.value, rText)}% of my wording`;
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
const HUMAN_COLOR = '#2d4a7c'; // bar — human portion (--human)
const AI_COLOR = '#1f8a8a';    // bar — AI portion (--ai)
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

// Outlook-safe two-tone ratio bar, built from background-colored table cells
// (no images, no SVG — renders natively in Outlook desktop and web).
function barTableHtml() {
  const ai = aiPct(), human = 100 - ai;
  const W = 120; // total px
  const hpx = Math.round(W * human / 100);
  const apx = W - hpx;
  const cell = (w, color) => w > 0
    ? `<td width="${w}" height="9" bgcolor="${color}" style="width:${w}px;height:9px;line-height:9px;font-size:0;background-color:${color};">&#160;</td>`
    : '';
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" title="Human ${human}% / AI ${ai}%" `
    + `style="display:inline-table;border-collapse:collapse;border:1px solid #d8d5ca;vertical-align:middle;"><tr>`
    + `${cell(hpx, HUMAN_COLOR)}${cell(apx, AI_COLOR)}</tr></table>`;
}

// HTML — inline styles only, no <style>/JS. Dynamic pieces escaped. Keeps the
// app's styling and embeds the Outlook-safe ratio bar on line 1.
function badgeHtml() {
  const label = escapeHtml(badgeLabel());
  const href = escapeHtml(aboutUrl());
  const star = `<span style="color:${STAR_COLOR};">✶</span>`;
  const link = `<a href="${href}" style="color:${LINK_COLOR};">Learn more</a>`;
  const bar = barTableHtml();
  const baseFont = `font-family:${FONT_STACK};font-size:13px;color:#4a4a45;`;

  // line 1 as a small table so the bar sits inline and aligned in Outlook
  const line1 = (withLink) =>
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;${baseFont}"><tr>`
    + `<td style="white-space:nowrap;padding:0 8px 0 0;vertical-align:middle;${baseFont}">${star} ${label}</td>`
    + `<td style="padding:0 8px 0 0;vertical-align:middle;">${bar}</td>`
    + (withLink ? `<td style="white-space:nowrap;vertical-align:middle;${baseFont}">· ${link}</td>` : '')
    + `</tr></table>`;

  if (badgeMode() === 'detailed') {
    const ctx = escapeHtml(contextText());
    if (showStats()) {
      const stats = escapeHtml(statsLine());
      return `<div style="${baseFont}line-height:1.5;">`
        + line1(true)
        + `<div>${ctx}</div>`
        + `<div style="color:${STAT_COLOR};">${stats}</div></div>`;
    }
    return `<div style="${baseFont}line-height:1.5;">`
      + line1(false)
      + `<div>${ctx}</div>`
      + `<div>${link}</div></div>`;
  }
  return `<div style="${baseFont}">${line1(true)}</div>`;
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

// ======================================================================
//  copy: formatted AI output + badge (rich clipboard, for pasting to Outlook)
// ======================================================================
function emailWithBadgeHtml() {
  const body = resultHtml(); // sanitised formatted email
  const badge = badgeHtml();
  const spacer = body ? '<br>' : '';
  return `<div style="font-family:${FONT_STACK};font-size:13px;color:#1c1c1a;">${body}${spacer}${badge}</div>`;
}
function emailWithBadgeText() {
  const body = resultText();
  return (body ? body + '\n\n' : '') + badgeText();
}

async function copyEmailWithBadge() {
  const html = emailWithBadgeHtml();
  const text = emailWithBadgeText();
  // Preferred: rich clipboard write (needs a secure context, e.g. https on Netlify)
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      toast('Email + badge copied — paste into Outlook ✓');
      return;
    } catch { /* fall through to execCommand */ }
  }
  // Fallback: select a hidden rich node and execCommand('copy'). Works on file://.
  if (richCopyFallback(html)) { toast('Email + badge copied — paste into Outlook ✓'); return; }
  copy(text, 'Copied as plain text'); // last resort
}

function richCopyFallback(html) {
  const holder = el('div'); // html is already sanitised
  holder.innerHTML = html;
  holder.setAttribute('contenteditable', 'true');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap;';
  document.body.appendChild(holder);
  let ok = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ok = document.execCommand('copy');
    sel.removeAllRanges();
  } catch { ok = false; }
  holder.remove();
  return ok;
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
    result: resultHtml(),
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

  // plain fields use .value (inert against markup); the rich result is
  // sanitised before it ever touches innerHTML, so a hostile file stays inert
  elOriginal.value = typeof rec.original === 'string' ? rec.original : '';
  elResult.innerHTML = typeof rec.result === 'string' ? sanitizeHtml(rec.result) : '';
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

  // sanitise rich pastes into the AI-output box (keep formatting, drop scripts/cruft)
  elResult.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    if (!data) return; // let the browser handle it
    e.preventDefault();
    const html = data.getData('text/html');
    const insert = html ? sanitizeHtml(html) : escapeHtml(data.getData('text/plain')).replace(/\n/g, '<br>');
    let done = false;
    try { done = document.execCommand('insertHTML', false, insert); } catch { done = false; }
    if (!done) { // fallback: insert sanitised nodes at the caret
      const tpl = document.createElement('template');
      tpl.innerHTML = insert;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(tpl.content);
      } else {
        elResult.appendChild(tpl.content);
      }
    }
    elResult.dispatchEvent(new Event('input', { bubbles: true }));
  });

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
  $('#copy-email-btn').addEventListener('click', copyEmailWithBadge);
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

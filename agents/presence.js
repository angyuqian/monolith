// Multiplayer mode (mock) — Figma/Miro-style live cursors for agents and teammates.
// Purely visual: nothing here changes app state. Agent cursors are driven by real events
// (agent started / finished) and anchored to real positions (sites, parcel, massing, panels).
// Teammate cursors follow a deliberate storyline: each beat points at something specific
// (Site D's grid, the compliance warning, a rubric weight…) and is skipped if it isn't on screen.
// Toggle: avatar row in the top bar, or press M. Reset turns it off.
import { esc } from '../js/ui/toast.js';

const HUMANS = [
  { id: 'andrew', name: 'Andrew', color: '#e5484d' },
  { id: 'sammie', name: 'Sammie', color: '#6e56cf' },
];
const MAX_AGENT_CURSORS = 3;
const MIN_WORK_MS = 3200; // cached results arrive in ~2 s; keep the choreography readable

const ARROW = (c) => `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2.5 19.5 10l-6.8 2.1-2.6 6.9Z" fill="${c}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

let app = null;
let on = false;
let epoch = 0;          // bumped on toggle/reset: running scripts exit
let layer = null;
let raf = null;
const cursors = new Map();
const pins = [];
let marquee = null;
let agentSlots = 0;
const waiting = [];     // agent scripts waiting for a free cursor slot
const results = new Map();
const once = new Set(); // beats that should only happen once per session (pins, highlights)

const sleep = (ms, ep = epoch) => new Promise((r) => setTimeout(r, ms)).then(() => { if (ep !== epoch) throw new Error('stopped'); });
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const q = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- targets (functions -> screen point)
function stageRect() { return app.ui.slots.stage.getBoundingClientRect(); }
function geo(lng, lat, dx = 0, dy = 0) {
  return () => {
    const r = stageRect();
    const p = app.map.project([lng, lat]);
    return { x: Math.max(r.left + 8, Math.min(r.right - 30, r.left + p.x + dx)), y: Math.max(r.top + 8, Math.min(r.bottom - 30, r.top + p.y + dy)) };
  };
}
// Bring a panel element into view before a cursor heads there (hub cards live in a scroll container).
function reveal(el) {
  el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  return el;
}
function visible(el) {
  if (!el?.isConnected) return false;
  const b = el.getBoundingClientRect();
  return b.width > 0 && b.height > 0 && b.bottom > 60 && b.top < window.innerHeight;
}
function dom(getEl, fx = 0.5, fy = 0.5, dx = 0, dy = 0) {
  return () => {
    const el = typeof getEl === 'function' ? getEl() : getEl;
    if (!el || !el.isConnected) return null;
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return { x: b.left + b.width * fx + dx, y: b.top + b.height * fy + dy };
  };
}
const letterOf = (s) => String.fromCharCode(65 + app.store.get().sites.findIndex((x) => x.id === s.id));
const siteBy = (letter) => app.store.get().sites[letter.charCodeAt(0) - 65];
const shortName = (s) => s.name.split(' · ')[1] || s.name;
const parcelRing = () => app.store.get().design?.geojson.lines.features[0]?.geometry.coordinates || null;
function massBBox() {
  const d = app.store.get().design;
  if (!d) return null;
  const r = stageRect();
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  d.geojson.masses.features.filter((f) => f.properties.kind !== 'parcel').forEach((f) => f.geometry.coordinates[0].forEach((c) => {
    const p = app.map.project(c);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }));
  return { x: r.left + x0 - 14, y: r.top + y0 - 34, w: x1 - x0 + 28, h: y1 - y0 + 48 }; // pad up for extrusion height
}

// ---------------------------------------------------------------- cursors (eased, deliberate motion)
function cursor(id, name, color) {
  if (cursors.has(id)) return cursors.get(id);
  const el = document.createElement('div');
  el.className = 'p-cursor';
  el.style.setProperty('--c', color);
  el.innerHTML = `${ARROW(color)}<div class="p-cursor__tag"><b>${esc(name)}</b><span class="p-cursor__say"></span></div>`;
  layer.appendChild(el);
  const r = stageRect();
  const start = { x: r.left + (Math.random() < 0.5 ? 40 : r.width - 40), y: r.top + r.height - 40 };
  const c = { id, name, el, color, pos: { ...start }, from: { ...start }, t0: 0, dur: 1, target: () => start, lastT: start, say: el.querySelector('.p-cursor__say') };
  cursors.set(id, c);
  requestAnimationFrame(() => el.classList.add('is-on'));
  return c;
}
function setTarget(c, target) {
  const t = target() || c.lastT;
  c.from = { ...c.pos };
  c.t0 = performance.now();
  c.dur = Math.max(420, Math.min(1300, Math.hypot(t.x - c.pos.x, t.y - c.pos.y) * 1.1));
  c.target = target;
}
function removeCursor(id) {
  const c = cursors.get(id);
  if (!c) return;
  cursors.delete(id);
  c.el.classList.remove('is-on');
  setTimeout(() => c.el.remove(), 300);
}
function say(c, text) {
  c.say.textContent = text || '';
  c.el.classList.toggle('has-say', !!text);
}
async function moveTo(c, target, { ep = epoch } = {}) {
  setTarget(c, target);
  await sleep(c.dur + 80, ep);
}
async function click(c) {
  c.el.classList.remove('is-click');
  void c.el.offsetWidth;
  c.el.classList.add('is-click');
  await sleep(260);
}

// ---------------------------------------------------------------- pins, marquee, text
function pin(lng, lat, author, color, text) {
  const el = document.createElement('div');
  el.className = 'p-pin';
  el.style.setProperty('--c', color);
  el.innerHTML = `<span class="p-pin__dot">${esc(author[0])}</span><span class="p-pin__text"><b>${esc(author)}</b> ${esc(text)}</span>`;
  layer.appendChild(el);
  const p = { el, pos: geo(lng, lat) };
  pins.push(p);
  requestAnimationFrame(() => el.classList.add('is-on'));
  setTimeout(() => el.classList.add('is-collapsed'), 6000);
  return p;
}
function showMarquee(color, label) {
  hideMarquee();
  const el = document.createElement('div');
  el.className = 'p-marquee';
  el.style.setProperty('--c', color);
  el.innerHTML = `<span>${esc(label)}</span>`;
  layer.appendChild(el);
  marquee = { el, grow: 0 };
}
function hideMarquee() {
  marquee?.el.remove();
  marquee = null;
}
// Highlight an element's text like a collaborator's selection (visual only).
function highlight(el, color) {
  if (!el || el.querySelector('.p-mark')) return null;
  const mark = document.createElement('mark');
  mark.className = 'p-mark';
  mark.style.setProperty('--c', color);
  while (el.firstChild) mark.appendChild(el.firstChild);
  el.appendChild(mark);
  return () => { if (!mark.isConnected) return; while (mark.firstChild) el.insertBefore(mark.firstChild, mark); mark.remove(); };
}
async function typeInto(container, text, c, before = null) {
  const p = document.createElement('p');
  p.className = 'p-typed';
  p.style.setProperty('--c', c.color);
  const span = document.createElement('span');
  const caret = document.createElement('i');
  caret.className = 'p-caret';
  p.append(span, caret);
  container.insertBefore(p, before);
  p.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTarget(c, dom(caret, 1, 0.9, 2, 2));
  for (const ch of text) {
    span.textContent += ch;
    await sleep(rand(30, 65));
  }
  await sleep(900);
  caret.remove();
}

// ---------------------------------------------------------------- frame loop
function frame(t) {
  if (!on) return;
  cursors.forEach((c) => {
    const target = c.target() || c.lastT;
    if (!target) return;
    c.lastT = target;
    const k = Math.min(1, (t - c.t0) / c.dur);
    const e = ease(k);
    // eased glide to the target, then a barely-there idle drift
    const drift = k >= 1 ? 0.7 : 0;
    c.pos.x = c.from.x + (target.x - c.from.x) * e + Math.sin(t / 900 + c.id.length) * drift;
    c.pos.y = c.from.y + (target.y - c.from.y) * e + Math.cos(t / 1100 + c.id.length) * drift;
    c.el.style.transform = `translate(${c.pos.x}px, ${c.pos.y}px)`;
  });
  pins.forEach((p) => {
    const pt = p.pos();
    if (pt) p.el.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
  });
  if (marquee) {
    const b = massBBox();
    if (b) {
      marquee.grow = Math.min(1, marquee.grow + 0.04);
      const e = 1 - (1 - marquee.grow) ** 3;
      Object.assign(marquee.el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w * e}px`, height: `${b.h * e}px` });
    }
  }
  raf = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- agent choreography
const done = (id) => results.has(id);

async function withSlot(fn) {
  if (agentSlots >= MAX_AGENT_CURSORS) await new Promise((r) => waiting.push(r));
  agentSlots++;
  try { await fn(); } finally {
    agentSlots--;
    waiting.shift()?.();
  }
}

// Keep "working" until the agent's result is in and the minimum time has passed.
async function workUntilDone(id, step) {
  const t0 = performance.now();
  let i = 0;
  while (!done(id) || performance.now() - t0 < MIN_WORK_MS) {
    await step(i++);
  }
  return results.get(id);
}

const SCRIPTS = {
  async siteScout(c) {
    const ranked = [...app.store.get().sites].sort((a, b) => b.score - a.score).slice(0, 4);
    const r = await workUntilDone('siteScout', async (i) => {
      const s = ranked[i % ranked.length];
      await moveTo(c, geo(s.lng, s.lat, 4, -20));
      say(c, `Site ${letterOf(s)} · ${s.score.toFixed(0)}`);
      await sleep(700);
    });
    const best = app.store.get().sites.find((s) => s.id === r?.data?.recommended_site_id) || ranked[0];
    await moveTo(c, geo(best.lng, best.lat, 4, -20));
    await click(c);
    say(c, `Recommends Site ${letterOf(best)}`);
    await sleep(2200);
  },

  async compliance(c) {
    const ring = parcelRing();
    if (!ring) return;
    say(c, 'Checking setbacks…');
    const r = await workUntilDone('compliance', async (i) => {
      const pt = ring[i % 4];
      if (i === 4) say(c, 'Measuring height…');
      if (i === 8) say(c, 'Reviewing grid & noise…');
      await moveTo(c, geo(pt[0], pt[1]));
      await sleep(200);
    });
    const checks = r?.data?.checks || [];
    const icon = { pass: '✓', warn: '⚠', fail: '✕' };
    const picks = [checks.find((x) => /setback|plot/i.test(x.rule)), checks.find((x) => /height/i.test(x.rule)), checks.find((x) => x.status !== 'pass')].filter(Boolean);
    for (let i = 0; i < Math.min(3, picks.length); i++) {
      await moveTo(c, geo(ring[i][0], ring[i][1]));
      await click(c);
      pin(ring[i][0], ring[i][1], 'Compliance', c.color, `${picks[i].rule} ${icon[picks[i].status] || ''}`);
      await sleep(350);
    }
    say(c, r?.status === 'fail' ? 'Blocking issues found' : 'Checks complete');
    await sleep(1800);
  },

  async render(c) {
    if (!massBBox()) return;
    await moveTo(c, () => { const b = massBBox(); return b && { x: b.x, y: b.y }; });
    showMarquee(c.color, 'Render Studio · framing shot');
    say(c, 'Framing shot…');
    await moveTo(c, () => { const b = massBBox(); return b && { x: b.x + b.w, y: b.y + b.h }; });
    await workUntilDone('render', async (i) => {
      await sleep(700);
      if (i === 3) say(c, 'Lighting: dusk…');
      if (i === 7) say(c, 'Rendering…');
    });
    await click(c);
    say(c, 'Render ready ✓');
    await sleep(1400);
    hideMarquee();
    await sleep(500);
  },

  async comms(c) {
    const card = () => q('[data-agent="comms"]');
    reveal(card());
    await moveTo(c, dom(card, 0.3, 0.4));
    say(c, 'Drafting…');
    await workUntilDone('comms', async () => { await sleep(500); });
    await sleep(700); // let the card render the draft
    const doc = q('[data-agent="comms"] [data-result] .doc');
    if (!doc) { await sleep(800); return; }
    const para = doc.querySelector('li') || doc.querySelector('p');
    reveal(doc.closest('[data-agent]'));
    await sleep(400);
    await moveTo(c, dom(para, 0.9, 0.5));
    say(c, 'Tightening the ask…');
    const unmark = highlight(para, c.color);
    await sleep(1600);
    // type above a short sign-off line ("[Name]", "Best regards," …) rather than after it
    let before = doc.lastElementChild;
    while (before?.previousElementSibling && before.previousElementSibling.textContent.trim().length < 40) before = before.previousElementSibling;
    if (!before || before.textContent.trim().length >= 40) before = null;
    await typeInto(doc, 'Happy to share the full financial model ahead of a call.', c, before);
    await sleep(1200);
    unmark?.();
  },
};

async function runAgentCursor(id) {
  const meta = app.registry.agent(id);
  const script = SCRIPTS[id];
  if (!meta || !script || cursors.has(id)) return;
  const ep = epoch;
  await withSlot(async () => {
    if (ep !== epoch) return;
    const c = cursor(id, meta.name, meta.color);
    try { await script(c); } catch { /* stopped */ }
    if (ep === epoch) removeCursor(id);
  });
}

// ---------------------------------------------------------------- teammates: deliberate storyline (visual only)
// Each beat: when() -> target element/point or null (skip), then say / click / pin / highlight.
const warnRow = () => [...document.querySelectorAll('[data-agent="compliance"] .check')].find((r) => r.querySelector('.pill--warn, .pill--fail'));

const STORY = {
  andrew: [
    {
      id: 'siteD',
      when: () => siteBy('D'),
      go: (s) => geo(s.lng, s.lat, 6, -22),
      say: (s) => `Site D — ${s.nearestSubstation.name.replace(/ Substation$/, '')} is right there`,
      click: true,
      pin: (s) => [s.lng, s.lat, `Check grid headroom at ${shortName(s)}`],
    },
    {
      id: 'complianceWarn',
      when: () => { const r = warnRow(); if (r) reveal(r); return r && visible(r) ? r : null; },
      go: (el) => dom(el, 0.96, 0.35),
      say: (el) => `${el.querySelector('.check__rule')?.firstChild?.textContent.trim() || 'This'} is our critical path`,
    },
    {
      id: 'complianceCard',
      when: () => (!warnRow() && q('[data-agent="compliance"]') && visible(q('[data-agent="compliance"]')) ? q('[data-agent="compliance"]') : null),
      go: (el) => dom(el, 0.7, 0.3),
      say: () => 'Can we run compliance on this one?',
    },
    {
      id: 'weakestBar', // points at the lowest-scoring criterion of the selected site
      when: () => {
        const rows = [...document.querySelectorAll('.site-detail .bars > div')].filter(visible);
        const val = (r) => Number(r.querySelector('.bar__head span:last-child')?.textContent) || 0;
        return rows.sort((x, y) => val(x) - val(y))[0] || null;
      },
      go: (el) => dom(el, 0.8, 0.3),
      say: (el) => `${el.querySelector('.bar__head span')?.textContent} is the weak spot (${el.querySelector('.bar__head span:last-child')?.textContent})`,
    },
    {
      id: 'parcel',
      when: () => parcelRing(),
      go: (ring) => geo((ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2),
      say: () => 'Room for more halls?',
      click: true,
      pin: (ring) => [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2, `Could we fit ${app.store.get().design.params.halls + 2} halls here?`],
    },
    {
      id: 'slider',
      when: () => { const i = q('#left-panel input[data-param="itMW"]'); return i && visible(i) ? i : null; },
      go: (el) => dom(el, (el.value - el.min) / (el.max - el.min), 0.5),
      say: (el) => `IT load ${el.value} → ${Math.min(+el.max, +el.value + 10)} MW?`,
    },
    {
      id: 'siteF',
      when: () => { const el = q('.site-item[data-site="site-6"]'); return el && visible(el) ? el : null; },
      go: (el) => dom(el, 0.55, 0.5),
      say: () => 'F keeps us near the Jurong talent pool',
    },
  ],
  sammie: [
    {
      id: 'score',
      when: () => { const el = q('.site-detail__score'); return el && visible(el) ? el : null; },
      go: (el) => dom(el, 0.9, 0.35),
      say: () => `${app.store.get().site?.score.toFixed(0)} — strongest in the cluster`,
    },
    {
      id: 'complianceSummary',
      when: () => { const el = q('[data-agent="compliance"] [data-summary]'); if (el?.textContent.trim()) reveal(el.closest('[data-agent]')); return el?.textContent.trim() && visible(el) ? el : null; },
      go: (el) => dom(el, 0.95, 0.8),
      say: () => 'Sharing this with legal 👍',
      highlight: true,
    },
    {
      id: 'siteA',
      when: () => siteBy('A'),
      go: (s) => geo(s.lng, s.lat, 6, -22),
      say: (s) => `A is ${s.nearestDataCentre.distanceM} m from the nearest DC`,
      click: true,
    },
    {
      id: 'renderImage',
      when: () => { const el = q('[data-agent="render"] .media-result img, [data-agent="render"] .media-result video'); if (el) reveal(el); return el && visible(el) ? el : null; },
      go: (el) => dom(el, 0.8, 0.3),
      say: () => 'This render goes in the deck',
    },
    {
      id: 'topPick',
      when: () => { const el = q('#left-panel .site-item'); return el && visible(el) ? el : null; },
      go: (el) => dom(el, 0.85, 0.5),
      say: () => 'Top of the shortlist'
    },
    {
      id: 'legend',
      when: () => { const el = q('.legend__ramp'); return el && visible(el) ? el : null; },
      go: (el) => dom(el, 0.85, 0.5),
      say: () => 'Darker cells = better fit',
    },
  ],
};

async function beat(c, b) {
  const subject = b.when();
  if (!subject) return false;
  await moveTo(c, b.go(subject));
  say(c, b.say(subject));
  if (b.click) await click(c);
  let unmark = null;
  if (b.pin && !once.has(`${c.id}-${b.id}`)) {
    once.add(`${c.id}-${b.id}`);
    const [lng, lat, text] = b.pin(subject);
    pin(lng, lat, c.name, c.color, text);
  }
  if (b.highlight) unmark = highlight(subject, c.color);
  await sleep(2600);
  unmark?.();
  say(c, '');
  return true;
}

async function humanLoop(h) {
  const ep = epoch;
  const c = cursor(h.id, h.name, h.color);
  const story = STORY[h.id];
  let i = 0;
  try {
    await sleep(h.id === 'andrew' ? 400 : 2200, ep);
    for (;;) {
      if (agentSlots >= 2) { await sleep(1200, ep); continue; } // step aside while agents work
      let acted = false;
      for (let n = 0; n < story.length && !acted; n++) acted = await beat(c, story[i++ % story.length]);
      await sleep(acted ? rand(1600, 2600) : 1500, ep);
    }
  } catch { /* stopped */ }
}

// ---------------------------------------------------------------- toggle + facepile
const ui = {};

function renderFacepile() {
  const agents = app.registry.visibleAgents();
  const faces = [...HUMANS.map((h) => ({ label: h.name[0], color: h.color, title: h.name })), ...agents.map((a) => ({ label: a.icon, color: a.color, title: a.name }))];
  ui.btn.classList.toggle('is-on', on);
  ui.btn.title = on ? 'Multiplayer on — click to hide (M)' : 'Show live collaborators (M)';
  ui.btn.innerHTML = `<span class="facepile">${faces.slice(0, 5).map((f, i) => `<span class="facepile__face" style="--c:${f.color};z-index:${10 - i}" title="${esc(f.title)}">${f.label}</span>`).join('')}</span>
    <span class="facepile__label">${on ? `<i class="facepile__live"></i>${faces.length} online` : 'Multiplayer'}</span>`;
}

function start() {
  on = true;
  epoch++;
  layer.hidden = false;
  raf = requestAnimationFrame(frame);
  HUMANS.forEach((h) => humanLoop(h));
  Object.entries(app.store.get().agents).forEach(([id, a]) => { if (a.status === 'running') runAgentCursor(id); });
  app.ui.toast(`${HUMANS.map((h) => h.name).join(' and ')} joined`);
  renderFacepile();
}

function stop() {
  on = false;
  epoch++;
  cancelAnimationFrame(raf);
  cursors.forEach((c, id) => removeCursor(id));
  pins.splice(0).forEach((p) => p.el.remove());
  hideMarquee();
  document.querySelectorAll('.p-mark').forEach((m) => { const el = m.parentNode; while (m.firstChild) el.insertBefore(m.firstChild, m); m.remove(); });
  document.querySelectorAll('.p-typed').forEach((p) => p.remove());
  waiting.splice(0).forEach((r) => r());
  agentSlots = 0;
  once.clear();
  if (ui.btn) renderFacepile();
}

export default {
  id: 'presence',
  name: 'Multiplayer',
  icon: '◎',
  color: '#6e56cf',
  stage: 'site',
  description: 'Live collaborator cursors (visual mock).',
  hidden: true,
  cache: false,

  init(ctx) {
    app = ctx;
    layer = document.createElement('div');
    layer.className = 'presence-layer';
    layer.hidden = true;
    document.body.appendChild(layer);

    ui.btn = document.createElement('button');
    ui.btn.type = 'button';
    ui.btn.className = 'facepile-btn';
    ctx.ui.slots.topbar.appendChild(ui.btn);
    ui.btn.onclick = () => (on ? stop() : start());
    renderFacepile();

    window.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (e.key.toLowerCase() !== 'm' || typing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (on) stop(); else start();
    });

    ctx.bus.on('agent:started', ({ id }) => { results.delete(id); if (on) runAgentCursor(id); });
    ctx.bus.on('agent:result', ({ id, result }) => { results.set(id, result); });
  },

  reset() {
    stop();
    results.clear();
  },
};

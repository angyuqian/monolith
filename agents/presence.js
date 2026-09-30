// Multiplayer mode (mock) — Figma/Miro-style live cursors for agents and teammates.
// Purely visual: nothing here changes app state. Agent cursors are driven by real events
// (agent started / finished) and anchored to real positions (sites, parcel, massing, panels).
// Human cursors ("Andrew", "Sammie") run scripted idle behaviours.
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

const sleep = (ms, ep = epoch) => new Promise((r) => setTimeout(r, ms)).then(() => { if (ep !== epoch) throw new Error('stopped'); });
const rand = (a, b) => a + Math.random() * (b - a);

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
function dom(getEl, fx = 0.5, fy = 0.5, dx = 0, dy = 0) {
  return () => {
    const el = typeof getEl === 'function' ? getEl() : getEl;
    if (!el || !el.isConnected) return null;
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return { x: b.left + b.width * fx + dx, y: b.top + b.height * fy + dy };
  };
}
function stagePoint(fx, fy) {
  return () => { const r = stageRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; };
}
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

// ---------------------------------------------------------------- cursors
function cursor(id, name, color) {
  if (cursors.has(id)) return cursors.get(id);
  const el = document.createElement('div');
  el.className = 'p-cursor';
  el.style.setProperty('--c', color);
  el.innerHTML = `${ARROW(color)}<div class="p-cursor__tag"><b>${esc(name)}</b><span class="p-cursor__say"></span></div>`;
  layer.appendChild(el);
  const r = stageRect();
  const start = { x: r.left + (Math.random() < 0.5 ? -40 : r.width + 40), y: r.top + rand(0.2, 0.8) * r.height };
  const c = { id, el, color, pos: { ...start }, target: () => start, lastT: start, jitter: 0, say: el.querySelector('.p-cursor__say') };
  cursors.set(id, c);
  requestAnimationFrame(() => el.classList.add('is-on'));
  return c;
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
async function moveTo(c, target, { timeout = 2600, ep = epoch } = {}) {
  c.target = target;
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    await sleep(60, ep);
    const t = c.lastT;
    if (t && Math.hypot(t.x - c.pos.x, t.y - c.pos.y) < 2) return;
  }
}
async function click(c) {
  c.el.classList.remove('is-click');
  void c.el.offsetWidth;
  c.el.classList.add('is-click');
  await sleep(220);
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
  setTimeout(() => el.classList.add('is-collapsed'), 5500);
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
  c.target = dom(caret, 1, 0.9, 2, 2);
  for (const ch of text) {
    span.textContent += ch;
    await sleep(rand(28, 70));
  }
  await sleep(900);
  caret.remove();
}

// ---------------------------------------------------------------- frame loop
function frame(t) {
  if (!on) return;
  const time = t / 1000;
  cursors.forEach((c) => {
    const target = c.target() || c.lastT;
    if (!target) return;
    c.lastT = target;
    const wob = 2.2;
    const tx = target.x + Math.sin(time * 1.3 + c.id.length) * wob;
    const ty = target.y + Math.cos(time * 1.1 + c.id.length * 2) * wob;
    c.pos.x += (tx - c.pos.x) * 0.13;
    c.pos.y += (ty - c.pos.y) * 0.13;
    c.el.style.transform = `translate(${c.pos.x}px, ${c.pos.y}px)`;
  });
  pins.forEach((p) => {
    const q = p.pos();
    if (q) p.el.style.transform = `translate(${q.x}px, ${q.y}px)`;
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
function agentMeta(id) { return app.registry.agent(id); }
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
    const sites = app.store.get().sites;
    say(c, 'Comparing sites…');
    const r = await workUntilDone('siteScout', async (i) => {
      const s = sites[[0, 5, 6, 1, 2, 4][i % 6]];
      await moveTo(c, geo(s.lng, s.lat, 4, -20));
      await sleep(450);
    });
    const best = sites.find((s) => s.id === r?.data?.recommended_site_id) || sites[0];
    await moveTo(c, geo(best.lng, best.lat, 4, -20));
    await click(c);
    say(c, `Recommends ${best.name.split(' · ')[0]}`);
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
      await moveTo(c, geo(pt[0], pt[1]), { timeout: 1600 });
      await sleep(250);
    });
    const checks = r?.data?.checks || [];
    const icon = { pass: '✓', warn: '⚠', fail: '✕' };
    const picks = [checks.find((x) => /setback|plot/i.test(x.rule)), checks.find((x) => /height/i.test(x.rule)), checks.find((x) => x.status !== 'pass')].filter(Boolean);
    const spots = [ring[0], ring[1], ring[2]];
    for (let i = 0; i < Math.min(3, picks.length); i++) {
      await moveTo(c, geo(spots[i][0], spots[i][1]), { timeout: 1400 });
      await click(c);
      pin(spots[i][0], spots[i][1], 'Compliance', c.color, `${picks[i].rule} ${icon[picks[i].status] || ''}`);
    }
    say(c, r?.status === 'fail' ? 'Blocking issues found' : 'Checks complete');
    await sleep(1800);
  },

  async render(c) {
    const b = () => massBBox();
    if (!b()) return;
    await moveTo(c, () => { const q = b(); return q && { x: q.x, y: q.y }; });
    showMarquee(c.color, 'Render Studio · framing shot');
    say(c, 'Framing shot…');
    c.target = () => { const q = b(); return q && { x: q.x + q.w, y: q.y + q.h }; };
    await workUntilDone('render', async (i) => {
      await sleep(700);
      if (i === 3) say(c, 'Lighting: dusk…');
      if (i === 7) say(c, 'Rendering…');
    });
    await click(c);
    say(c, 'Render ready ✓');
    await sleep(1400);
    hideMarquee();
    await sleep(600);
  },

  async comms(c) {
    const card = () => document.querySelector('[data-agent="comms"]');
    reveal(card());
    await moveTo(c, dom(card, 0.3, 0.4));
    say(c, 'Drafting…');
    await workUntilDone('comms', async () => { await sleep(500); });
    await sleep(700); // let the card render the draft
    const doc = document.querySelector('[data-agent="comms"] [data-result] .doc');
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
  const meta = agentMeta(id);
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

// ---------------------------------------------------------------- humans (visual only)
const once = new Set();
const HUMAN_BEHAVIOURS = {
  async wander(c) {
    await moveTo(c, stagePoint(rand(0.2, 0.8), rand(0.2, 0.7)));
    await sleep(rand(600, 1400));
  },
  async visitSite(c) {
    const sites = app.store.get().sites;
    const s = sites[Math.floor(rand(0, sites.length))];
    await moveTo(c, geo(s.lng, s.lat, 6, -18));
    say(c, `Looking at ${s.name.split(' · ')[0]}`);
    await sleep(1500);
    say(c, '');
  },
  async commentParcel(c) {
    const ring = parcelRing();
    const d = app.store.get().design;
    if (!ring || once.has(`pin-${c.id}`)) return HUMAN_BEHAVIOURS.wander(c);
    once.add(`pin-${c.id}`);
    const mid = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2];
    const spot = c.id === 'andrew' ? mid : ring[3];
    await moveTo(c, geo(spot[0], spot[1]));
    await click(c);
    pin(spot[0], spot[1], c.name, c.color, c.id === 'andrew' ? `Could we fit ${d.params.halls + 2} halls here?` : 'Love the green buffer to the road 🌿');
    await sleep(1500);
  },
  async nudgeSlider(c) {
    const input = document.querySelector('#left-panel input[data-param="itMW"]');
    if (!input || once.has('slider')) return HUMAN_BEHAVIOURS.wander(c);
    once.add('slider');
    const frac = (input.value - input.min) / (input.max - input.min);
    const at = (f) => dom(input, f, 0.5);
    await moveTo(c, at(frac));
    say(c, `IT load ${input.value} → ${Math.min(+input.max, +input.value + 10)} MW?`);
    c.el.classList.add('is-drag');
    await moveTo(c, at(Math.min(1, frac + 0.09)), { timeout: 1500 });
    await sleep(900);
    await moveTo(c, at(frac), { timeout: 1500 });
    c.el.classList.remove('is-drag');
    await sleep(1400);
    say(c, '');
  },
  async selectText(c) {
    const el = document.querySelector('[data-agent="compliance"] [data-summary]');
    if (!el?.textContent.trim() || once.has(`sel-${c.id}`)) return HUMAN_BEHAVIOURS.hoverCard(c);
    once.add(`sel-${c.id}`);
    reveal(el.closest('[data-agent]'));
    await sleep(400);
    await moveTo(c, dom(el, 0.95, 0.8));
    const unmark = highlight(el, c.color);
    say(c, 'Sharing with legal 👍');
    await sleep(2600);
    unmark?.();
    say(c, '');
  },
  async hoverCard(c) {
    const cards = [...document.querySelectorAll('#agents-list [data-agent]')];
    const card = cards[Math.floor(rand(0, cards.length))];
    await moveTo(c, dom(card, rand(0.3, 0.8), 0.5));
    await sleep(rand(900, 1600));
  },
};

async function humanLoop(h) {
  const ep = epoch;
  const c = cursor(h.id, h.name, h.color);
  const plan = h.id === 'andrew'
    ? ['wander', 'visitSite', 'commentParcel', 'nudgeSlider', 'hoverCard', 'wander']
    : ['hoverCard', 'wander', 'selectText', 'commentParcel', 'visitSite', 'wander'];
  let i = h.id === 'andrew' ? 0 : 2;
  try {
    await sleep(h.id === 'andrew' ? 300 : 1400, ep);
    for (;;) {
      if (agentSlots >= 2) { await sleep(1200, ep); continue; } // stay out of the way while agents work
      await HUMAN_BEHAVIOURS[plan[i++ % plan.length]](c);
      await sleep(rand(1500, 3500), ep);
    }
  } catch { /* stopped */ }
}

// ---------------------------------------------------------------- toggle + facepile
function renderFacepile() {
  const agents = app.registry.visibleAgents();
  const faces = [...HUMANS.map((h) => ({ label: h.name[0], color: h.color, title: h.name })), ...agents.map((a) => ({ label: a.icon, color: a.color, title: a.name }))];
  ui.btn.classList.toggle('is-on', on);
  ui.btn.title = on ? 'Multiplayer on — click to hide (M)' : 'Show live collaborators (M)';
  ui.btn.innerHTML = `<span class="facepile">${faces.slice(0, 5).map((f, i) => `<span class="facepile__face" style="--c:${f.color};z-index:${10 - i}" title="${esc(f.title)}">${f.label}</span>`).join('')}</span>
    <span class="facepile__label">${on ? `<i class="facepile__live"></i>${faces.length} online` : 'Multiplayer'}</span>`;
}
const ui = {};

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

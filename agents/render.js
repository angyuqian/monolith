// Render — turns the live 3D massing into a photoreal concept image (Nano Banana) and a flythrough video (Gemini Omni).
// Background pre-rendering: when a site is picked or the design settles, both are started quietly, so a later
// click (or voice request) picks up the job already in progress. See CONFIG.CACHE.prefetch.
// TEAMMATE (Omni): extend genVideo() — camera paths, multiple shots, day/night variants, stitching.
import { CONFIG } from '../config.js';
import { cacheKeys } from '../js/core/cache.js';
import { esc } from '../js/ui/toast.js';

const STYLES = {
  day: 'bright tropical midday, soft clouds',
  dusk: 'golden-hour dusk, warm facade lighting, glowing windows',
  night: 'night, crisp architectural lighting, subtle blue accents',
};
// analysis overlays the image models shouldn't see (text labels are always hidden)
const HIDE = ['suit-fill', 'suit-selected', 'dc-halo', 'dc-dot', 'sub-halo', 'sub-dot', 'design-lines'];

let style = 'dusk';

function describe(design) {
  const m = design.metrics;
  const p = design.params;
  return `${m.itMW} MW hyperscale data centre, ${p.halls} data halls over ${p.storeys} storeys (${m.heightM} m tall), ${p.cooling === 'liquid' ? 'direct-liquid cooling with rooftop dry coolers' : 'air cooling with rooftop chillers'}, ${m.gensets} diesel generator containers in the service yard, on-site substation`;
}

// Clean 16:9 snapshot of the 3D view. Overlays are hidden for ~2 frames only, so it's invisible to the viewer.
async function snapshot(ctx, { forceThreeD = false } = {}) {
  if (forceThreeD && ctx.store.get().mode === '2d') ctx.actions.setMode('3d');
  return ctx.map.cleanSnapshot({ hide: HIDE, maxWidth: 1280, aspect: 16 / 9 });
}

async function genImage(ctx, s, shot, design) {
  const res = await ctx.gemini.image(
    `Transform this 3D massing screenshot into a photorealistic architectural visualisation. Keep the exact camera angle, massing, footprint and position. It shows a ${describe(design)} in a Singapore industrial estate. Sand-coloured blocks = data halls (ribbed white/grey metal cladding, subtle vertical louvres), blue block = glazed office/admin entrance, purple block = electrical substation, small grey boxes = generator containers, light-blue rooftop rows = cooling units. The white surrounding blocks are existing buildings: render them as realistic neighbouring warehouses and factories. Green parcel = lush tropical landscaping with trees. Lighting: ${STYLES[s]}. Aerial architectural photography, high detail.`,
    { images: [shot] },
  );
  return { status: 'info', summary: `Concept render ready (${s}) — ${design.metrics.itMW} MW campus.`, media: { type: 'image', src: res.images[0] }, data: { snapshot: shot } };
}

async function genVideo(ctx, s, shot, design) {
  const res = await ctx.gemini.omni(
    `Generate a short cinematic landscape (16:9, horizontal) drone flythrough video that slowly orbits this proposed building. The image is a 3D massing model of a ${describe(design)} in a Singapore industrial estate. Render it photorealistically: sand-coloured blocks are data halls with ribbed white metal cladding, the blue block is a glazed office, purple is the substation, grey boxes are generator containers, light-blue rooftop rows are cooling units. Keep the layout of the massing. ${STYLES[s]}. Lush tropical landscaping.`,
    { images: [shot] },
  );
  if (!res.videos.length && !res.images.length) throw new Error(res.text || 'Omni returned no media');
  const media = res.videos.length ? { type: 'video', src: res.videos[0] } : { type: 'image', src: res.images[0] };
  return { status: 'info', summary: `Omni flythrough ready (${s}).`, media, data: { snapshot: shot } };
}

// User-initiated flythrough (button, voice, chat). Cache / in-flight background job are checked by runTask first.
const runFlythrough = (ctx, s = style) => ctx.actions.runTask('render', async (c) => {
  const design = c.getDesign();
  if (!design) return { status: 'warn', summary: 'Select a site first.' };
  c.ui.toast('Omni is rendering a flythrough — this can take a minute or two');
  return genVideo(c, s, await snapshot(c, { forceThreeD: true }), design);
}, null, { variant: `video:${s}` });

// ---------------------------------------------------------------- background pre-rendering
const busy = { image: false, video: false };
const queued = { image: null, video: null }; // latest waiting job per kind (older ones are dropped)
let prefetchTimer = null;

function startJob(ctx, kind, job) {
  busy[kind] = true;
  ctx.cache.track(job.keys, job.run())
    .catch((e) => console.warn(`[render] background ${kind} failed:`, e.message))
    .finally(() => {
      busy[kind] = false;
      const next = queued[kind];
      queued[kind] = null;
      if (next && !ctx.cache.isInflight(next.keys)) startJob(ctx, kind, next);
    });
}

async function prefetch(ctx) {
  const P = CONFIG.CACHE?.prefetch;
  if (!P?.enabled || !ctx.cache.readsEnabled()) return; // reads are off during `npm run prewarm`
  const { site, design, mode } = ctx.store.get();
  if (!site || !design || mode !== '3d') return;
  const kinds = P.video ? ['image', 'video'] : ['image'];
  const todo = [];
  for (const kind of kinds) {
    const keys = cacheKeys({ agentId: 'render', variant: `${kind}:${style}`, site, params: design.params });
    if (ctx.cache.isInflight(keys) || await ctx.cache.get(keys)) continue; // already cached or being made
    todo.push({ kind, keys });
  }
  if (!todo.length) return;
  const { map } = ctx.map;
  await new Promise((r) => { if (map.loaded() && !map.isMoving()) r(); else map.once('idle', r); setTimeout(r, 6000); });
  if (ctx.store.get().design !== design || ctx.store.get().mode !== '3d') return; // changed meanwhile: a newer prefetch is scheduled
  const shot = await snapshot(ctx);
  const s = style;
  for (const { kind, keys } of todo) {
    const job = { keys, run: () => (kind === 'image' ? genImage : genVideo)(ctx, s, shot, design) };
    if (busy[kind]) queued[kind] = job;
    else startJob(ctx, kind, job);
  }
}

export default {
  id: 'render',
  name: 'Render Studio',
  icon: '◐',
  color: '#5b7fc7',
  stage: 'design',
  description: 'Photoreal concept renders (Nano Banana) and flythroughs (Gemini Omni).',

  init(ctx) {
    const P = CONFIG.CACHE?.prefetch || {};
    const schedule = (ms) => {
      clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(() => prefetch(ctx).catch((e) => console.warn('[render] prefetch', e)), ms);
    };
    ctx.bus.on('site:selected', () => schedule(3000));                // once the fly-in settles
    ctx.bus.on('design:changed', () => schedule(P.settleMs ?? 4000)); // slider stopped moving
    ctx.store.on('mode', (m) => { if (m === '3d') schedule(1500); });
  },

  mount(el, ctx) {
    el.innerHTML = `
      <div class="row" style="margin-bottom:8px">
        <select class="input grow" data-style>${Object.keys(STYLES).map((k) => `<option value="${k}" ${k === style ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
      </div>
      <div class="row">
        <button class="btn btn--sm grow" data-act="image">◐ Concept render</button>
        <button class="btn btn--sm btn--coral grow" data-act="video">▶ Omni flythrough</button>
      </div>`;
    el.querySelector('[data-style]').onchange = (e) => { style = e.target.value; };
    el.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'image') ctx.actions.runAgent('render');
      else runFlythrough(ctx);
    };
  },

  // cache per style: image:dusk, image:night…
  cacheVariant: (ctx, opts = {}) => `image:${opts.style || style}`,

  async run(ctx, opts = {}) {
    const s = opts.style || style;
    const design = ctx.getDesign();
    if (!design) return { status: 'warn', summary: 'Select a site first.' };
    return genImage(ctx, s, await snapshot(ctx, { forceThreeD: true }), design);
  },

  renderResult(el, result, ctx) {
    const m = result.media;
    if (!m) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="media-result">${m.type === 'video'
      ? `<video src="${m.src}" autoplay muted loop playsinline controls></video>`
      : `<img src="${m.src}" alt="Concept render">`}
      <div class="media-result__cap">${esc(result.offline ? 'Offline: massing snapshot' : m.type === 'video' ? 'Gemini Omni · click to expand' : 'Nano Banana · click to expand')}</div></div>`;
    el.querySelector('img,video').onclick = () => ctx.ui.lightbox(m.src, m.type);
  },

  async fallback(ctx) {
    const shot = ctx.snapshot();
    return { status: 'info', summary: 'Render service offline — showing the live massing snapshot.', media: { type: 'image', src: shot } };
  },

  reset() {
    clearTimeout(prefetchTimer);
    queued.image = null;
    queued.video = null; // jobs already running finish and land in the cache; nothing is shown
  },

  tools: [
    {
      name: 'render_flythrough',
      description: 'Generate a cinematic flythrough video of the current design with Gemini Omni (takes 1-2 minutes unless pre-rendered).',
      parameters: { type: 'object', properties: { style: { type: 'string', enum: Object.keys(STYLES) } } },
      handler: async ({ style: s }, ctx) => {
        const result = await runFlythrough(ctx, s || style);
        return { status: result.status, summary: result.summary };
      },
    },
  ],
};

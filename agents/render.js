// Render — turns the live 3D massing into a photoreal concept image (Nano Banana) and a flythrough video (Gemini Omni).
// TEAMMATE (Omni): extend flythrough() — camera paths, multiple shots, day/night variants, stitching.
import { esc } from '../js/ui/toast.js';

const STYLES = {
  day: 'bright tropical midday, soft clouds',
  dusk: 'golden-hour dusk, warm facade lighting, glowing windows',
  night: 'night, crisp architectural lighting, subtle blue accents',
};

function describe(design) {
  const m = design.metrics;
  const p = design.params;
  return `${m.itMW} MW hyperscale data centre, ${p.halls} data halls over ${p.storeys} storeys (${m.heightM} m tall), ${p.cooling === 'liquid' ? 'direct-liquid cooling with rooftop dry coolers' : 'air cooling with rooftop chillers'}, ${m.gensets} diesel generator containers in the service yard, on-site substation`;
}

// Hide analysis overlays so the model sees clean massing, snapshot, then restore.
async function cleanSnapshot(ctx) {
  const { store, map } = ctx;
  const prev = store.get().layers;
  const wasMode = store.get().mode;
  if (wasMode === '2d') ctx.actions.setMode('3d');
  store.merge('layers', { suitability: false, sites: false, datacentres: false, substations: false, landuse: false });
  const shot = await map.cleanSnapshot({ hide: ['design-lines'], maxWidth: 1280, aspect: 16 / 9 });
  store.set({ layers: prev });
  return shot;
}

let style = 'dusk';

const runFlythrough = (ctx, s = style) => ctx.actions.runTask('render', (c) => flythrough(c, s), null, { variant: `video:${s}` });

async function flythrough(ctx, s = style) {
  const design = ctx.getDesign();
  if (!design) return { status: 'warn', summary: 'Select a site first.' };
  ctx.ui.toast('Omni is rendering a flythrough — this can take a minute or two');
  const shot = await cleanSnapshot(ctx);
  const res = await ctx.gemini.omni(
    `Generate a short cinematic landscape (16:9, horizontal) drone flythrough video that slowly orbits this proposed building. The image is a 3D massing model of a ${describe(design)} in a Singapore industrial estate. Render it photorealistically: sand-coloured blocks are data halls with ribbed white metal cladding, the blue block is a glazed office, purple is the substation, grey boxes are generator containers, light-blue rooftop rows are cooling units. Keep the layout of the massing. ${STYLES[s]}. Lush tropical landscaping.`,
    { images: [shot] },
  );
  if (!res.videos.length && !res.images.length) throw new Error(res.text || 'Omni returned no media');
  const media = res.videos.length ? { type: 'video', src: res.videos[0] } : { type: 'image', src: res.images[0] };
  return { status: 'info', summary: `Omni flythrough ready (${s}).`, media, data: { snapshot: shot } };
}

export default {
  id: 'render',
  name: 'Render Studio',
  icon: '◐',
  color: '#5b7fc7',
  stage: 'design',
  description: 'Photoreal concept renders (Nano Banana) and flythroughs (Gemini Omni).',

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
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'image') return ctx.actions.runAgent('render');
      runFlythrough(ctx);
    };
  },

  // cache per style: image:dusk, image:night…
  cacheVariant: (ctx, opts = {}) => `image:${opts.style || style}`,

  async run(ctx, opts = {}) {
    const s = opts.style || style;
    const design = ctx.getDesign();
    if (!design) return { status: 'warn', summary: 'Select a site first.' };
    const shot = await cleanSnapshot(ctx);
    const res = await ctx.gemini.image(
      `Transform this 3D massing screenshot into a photorealistic architectural visualisation. Keep the exact camera angle, massing, footprint and position. It shows a ${describe(design)} in a Singapore industrial estate. Sand-coloured blocks = data halls (ribbed white/grey metal cladding, subtle vertical louvres), blue block = glazed office/admin entrance, purple block = electrical substation, small grey boxes = generator containers, light-blue rooftop rows = cooling units. The white surrounding blocks are existing buildings: render them as realistic neighbouring warehouses and factories. Green parcel = lush tropical landscaping with trees. Lighting: ${STYLES[s]}. Aerial architectural photography, high detail.`,
      { images: [shot] },
    );
    return { status: 'info', summary: `Concept render ready (${s}) — ${design.metrics.itMW} MW campus.`, media: { type: 'image', src: res.images[0] }, data: { snapshot: shot } };
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

  tools: [
    {
      name: 'render_flythrough',
      description: 'Generate a cinematic flythrough video of the current design with Gemini Omni (takes 1-2 minutes).',
      parameters: { type: 'object', properties: { style: { type: 'string', enum: Object.keys(STYLES) } } },
      handler: async ({ style: s }, ctx) => {
        const result = await runFlythrough(ctx, s || style);
        return { status: result.status, summary: result.summary };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent template — copy to agents/yourAgent.js and add 'yourAgent.js' to agents/index.js.
//
// ctx (passed to every hook):
//   ctx.getSite()            selected site  { id, name, lat, lng, score, breakdown, nearestSubstation, nearestDataCentre }
//   ctx.getDesign()          { params, metrics, warnings, geojson }  (see js/design/massing.js)
//   ctx.snapshot()           JPEG dataURL of the current 3D view
//   ctx.gemini               generate / generateJSON / image / omni / video   (js/core/gemini.js)
//   ctx.actions              selectSite, setDesignParams, setStage, setMode, toggleLayer, flyTo, runAgent,
//                            runTask(agentId, async (ctx) => result)  — run extra jobs with full status UI
//   ctx.store / ctx.bus      shared state + events (read other agents' results: ctx.store.get().agents.compliance)
//   ctx.map                  map adapter (ctx.map.map is the raw MapLibre instance for custom layers)
//   ctx.ui                   toast(text), lightbox(src, 'image'|'video'), ask(text) to message the orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export default {
  id: 'template',                 // unique, used by the orchestrator: run_agent({ agent_id: 'template' })
  name: 'Template Agent',
  icon: '◆',                      // a single glyph or emoji
  color: '#5b7fc7',               // accent for card, constellation link, chat badge
  stage: 'review',                // 'site' | 'design' | 'review' — where it belongs in the workflow
  description: 'One line explaining what this agent does.',
  manualOnly: false,              // true = skipped by "Run all agents"
  hidden: false,                  // true = no hub card / constellation node (agent owns its UI elsewhere, see voice.js)
  cache: true,                    // false = never serve/save cached results (e.g. live data)
  cacheScope: 'site',             // 'global' if the result doesn't depend on the selected site
  cacheVariant: (ctx, opts) => 'run', // distinguish outputs of one agent, e.g. `image:${opts.style}`

  // Optional: called once at boot, for UI outside the card. Slots: ctx.ui.slots.command (command bar), ctx.ui.slots.stage (map).
  // ctx.orchestrator exposes tools() / system / state() so other front-ends can drive the same actions.
  init(ctx) {},

  // Optional: render custom controls into the agent's card (buttons, selects…). Called once.
  mount(el, ctx) {
    // el.innerHTML = '<button class="btn btn--sm">Do thing</button>';
  },

  // Required for a runnable agent. Return { status, summary, data?, media? }.
  //   status: 'pass' | 'warn' | 'fail' | 'info'
  //   summary: one or two sentences (shown in hub, chat, constellation card, and fed back to the orchestrator)
  //   media: { type: 'image' | 'video', src } shown on the constellation card
  // opts come from ctx.actions.runAgent(id, opts) — e.g. { style: 'night' }
  async run(ctx, opts = {}) {
    const site = ctx.getSite();
    if (!site) return { status: 'warn', summary: 'Select a site first.' };
    const text = (await ctx.gemini.generate(`Say something useful about ${site.name}.`)).text;
    return { status: 'info', summary: text.slice(0, 200), data: { text } };
  },

  // Optional: rich result rendering inside the agent card.
  renderResult(el, result, ctx) {
    // el.innerHTML = `<div class="doc">${result.data.text}</div>`;
  },

  // Optional: clear module-level state when the presenter hits Reset.
  reset(ctx) {},

  // Optional: canned result used when Gemini fails and CONFIG.DEMO_FALLBACK is on.
  fallback(ctx) {
    return { status: 'info', summary: 'Offline demo output.' };
  },

  // Optional: extra tools the orchestrator (Gemini function calling) can call. Params use JSON Schema.
  tools: [
    // {
    //   name: 'template_do_thing',
    //   description: 'What the tool does, for the model.',
    //   parameters: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    //   handler: async (args, ctx) => ({ ok: true }),
    // },
  ],
};

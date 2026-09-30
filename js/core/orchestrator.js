// Orchestrator: Gemini function-calling loop over core tools + every registered agent's tools.
import { CONFIG } from '../../config.js';
import { gemini } from './gemini.js';
import { registry } from './registry.js';
import { store } from './store.js';

const LAYERS = ['buildings', 'landuse', 'suitability', 'sites', 'datacentres', 'substations', 'design'];

function summariseState() {
  const s = store.get();
  const agents = Object.fromEntries(Object.entries(s.agents).map(([id, a]) => [id, { status: a.status, summary: a.result?.summary }]));
  return {
    stage: s.stage,
    viewMode: s.mode,
    selectedSite: s.site && { id: s.site.id, name: s.site.name, score: s.site.score, breakdown: s.site.breakdown, nearestSubstation: s.site.nearestSubstation, nearestDataCentre: s.site.nearestDataCentre },
    design: s.design && { params: s.design.params, metrics: s.design.metrics, warnings: s.design.warnings },
    agents,
  };
}

function coreTools(ctx) {
  const { actions } = ctx;
  return [
    {
      name: 'list_candidate_sites',
      description: 'List the pre-scored candidate data-centre sites in Singapore with suitability score (0-100), score breakdown (land, power, fibre, community) and nearest substation / data centre.',
      parameters: { type: 'object', properties: {} },
      handler: () => store.get().sites.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, score: s.score, breakdown: s.breakdown, nearestSubstation: s.nearestSubstation, nearestDataCentre: s.nearestDataCentre })),
    },
    {
      name: 'select_site',
      description: 'Select a candidate site by id (e.g. "site-3"), fly the camera to it and generate a default data-centre massing on it.',
      parameters: { type: 'object', properties: { site_id: { type: 'string' } }, required: ['site_id'] },
      handler: ({ site_id }) => {
        const site = actions.selectSite(site_id);
        return site ? { ok: true, site: site.name } : { ok: false, error: 'unknown site id' };
      },
    },
    {
      name: 'fly_to',
      description: 'Move the camera to a location in Singapore. zoom 11 = whole island, 14 = district, 16 = single site.',
      parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, zoom: { type: 'number' } }, required: ['lat', 'lng'] },
      handler: ({ lat, lng, zoom = 14 }) => { actions.flyTo({ lat, lng, zoom }); return { ok: true }; },
    },
    {
      name: 'set_view_mode',
      description: 'Switch between 2D plan view and 3D perspective view.',
      parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['2d', '3d'] } }, required: ['mode'] },
      handler: ({ mode }) => { actions.setMode(mode); return { ok: true }; },
    },
    {
      name: 'set_design_params',
      description: 'Change the parametric data-centre design on the selected site. Only pass fields to change. Returns updated metrics.',
      parameters: {
        type: 'object',
        properties: {
          itMW: { type: 'number', description: 'critical IT load in MW (5-120)' },
          halls: { type: 'integer', description: 'number of data halls (1-8)' },
          storeys: { type: 'integer', description: '1-6' },
          cooling: { type: 'string', enum: ['liquid', 'air'] },
          redundancy: { type: 'string', enum: ['N+1', '2N'] },
          rotation: { type: 'number', description: 'degrees, -90..90' },
          parcelW: { type: 'number', description: 'parcel width m (120-400)' },
          parcelD: { type: 'number', description: 'parcel depth m (100-300)' },
        },
      },
      handler: (args) => {
        if (!store.get().site) return { ok: false, error: 'select a site first' };
        const d = actions.setDesignParams(args);
        actions.setStage('design');
        return { ok: true, metrics: d.metrics, warnings: d.warnings };
      },
    },
    {
      name: 'set_stage',
      description: 'Switch workflow stage: site (find a site), design (massing), review (agents: compliance, comms, renders).',
      parameters: { type: 'object', properties: { stage: { type: 'string', enum: ['site', 'design', 'review'] } }, required: ['stage'] },
      handler: ({ stage }) => { actions.setStage(stage); return { ok: true }; },
    },
    {
      name: 'toggle_layer',
      description: `Show or hide a map layer. Layers: ${LAYERS.join(', ')}.`,
      parameters: { type: 'object', properties: { layer: { type: 'string', enum: LAYERS }, visible: { type: 'boolean' } }, required: ['layer', 'visible'] },
      handler: ({ layer, visible }) => ({ ok: actions.toggleLayer(layer, visible) }),
    },
    {
      name: 'run_agent',
      description: `Run a specialist agent and return its result. Agents: ${registry.agents().filter((a) => a.run).map((a) => `${a.id} (${a.description})`).join('; ')}.`,
      parameters: { type: 'object', properties: { agent_id: { type: 'string', enum: registry.agents().filter((a) => a.run).map((a) => a.id) } }, required: ['agent_id'] },
      handler: async ({ agent_id }) => {
        const r = await actions.runAgent(agent_id);
        return r ? { status: r.status, summary: r.summary } : { error: 'unknown agent' };
      },
    },
    {
      name: 'get_state',
      description: 'Get the current app state: selected site, design parameters and metrics, agent results.',
      parameters: { type: 'object', properties: {} },
      handler: () => summariseState(),
    },
  ];
}

const SYSTEM = `You are Monolith, an AI copilot for siting and designing hyperscale data centres in Singapore.
You control a 3D map app through tools. Act first, then answer briefly (max ~70 words, plain sentences or short bullets).
Context: Singapore's DC-CFA framework (IMDA/EDB) requires best-in-class efficiency (PUE <= 1.3), Green Mark Platinum, and B2 industrial zoning.
Suitability scores combine land use (industrial share), power (distance to 400kV/230kV substations), fibre (proximity to existing DCs) and community (distance from housing).
When the user asks to find a site, call list_candidate_sites, pick the best match for their constraints, then select_site. Singapore geography: Jurong/Tuas = west, Loyang/Changi = east, Woodlands/Kranji = north, Ubi/Kaki Bukit/Paya Lebar = east-central.
When asked to design or change capacity, use set_design_params. When asked to check, render or communicate, use run_agent.`;

export function createOrchestrator(getCtx) {
  const history = [];
  let generation = 0; // bumped by reset(): an in-flight turn stops before running more tools

  function allTools() {
    const ctx = getCtx();
    return [...coreTools(ctx), ...registry.tools()];
  }

  async function exec(fc, tools, onTool) {
    const tool = tools.find((t) => t.name === fc.name);
    onTool?.(fc);
    if (!tool) return { error: `unknown tool ${fc.name}` };
    try {
      return (await tool.handler(fc.args || {}, getCtx())) ?? { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  async function send(text, { onTool } = {}) {
    const tools = allTools();
    const gen = generation;
    history.push({ role: 'user', parts: [{ text: `${text}\n\n[app state: ${JSON.stringify(summariseState())}]` }] });
    try {
      for (let i = 0; i < 6; i++) {
        const res = await gemini.generate(history, { system: SYSTEM, tools, timeout: 60000 });
        if (gen !== generation) return null;
        history.push(res.content);
        if (!res.functionCalls.length) return res.text || 'Done.';
        const parts = [];
        for (const fc of res.functionCalls) {
          const result = await exec(fc, tools, onTool);
          parts.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: { result } } });
        }
        history.push({ role: 'user', parts });
      }
      return 'I ran several steps — take a look at the map.';
    } catch (err) {
      console.warn('[orchestrator]', err);
      history.length = 0; // drop a possibly half-finished turn
      if (!CONFIG.DEMO_FALLBACK) throw err;
      return localIntent(text, tools, onTool);
    }
  }

  // Offline fallback: keyword routing so the command bar still drives the demo without Gemini.
  async function localIntent(text, tools, onTool) {
    const t = text.toLowerCase();
    const run = (name, args) => exec({ name, args }, tools, onTool);
    const sites = store.get().sites;
    const letter = t.match(/\bsite\s+([a-h])\b/);
    if (letter) { const s = sites[letter[1].charCodeAt(0) - 97]; await run('select_site', { site_id: s.id }); return `Selected ${s.name}. (offline mode)`; }
    if (/\b2d\b|plan view/.test(t)) { await run('set_view_mode', { mode: '2d' }); return 'Switched to 2D plan view.'; }
    if (/\b3d\b/.test(t)) { await run('set_view_mode', { mode: '3d' }); return 'Switched to 3D.'; }
    const mw = t.match(/(\d+)\s*mw/);
    if (mw && store.get().site) { await run('set_design_params', { itMW: +mw[1] }); return `Updated the design to ${mw[1]} MW.`; }
    for (const a of registry.agents().filter((x) => x.run)) {
      if (t.includes(a.id) || t.includes(a.name.toLowerCase())) { await run('run_agent', { agent_id: a.id }); return `Ran the ${a.name} agent.`; }
    }
    const regions = { jurong: 'Clementi', west: 'Clementi', east: 'Loyang', changi: 'Loyang', loyang: 'Loyang', ubi: 'Ubi', paya: 'Ubi', kaki: 'Kaki' };
    const hit = Object.keys(regions).find((k) => t.includes(k));
    const site = hit ? sites.find((s) => s.name.includes(regions[hit])) : sites[0];
    if (/site|find|where|locat|best/.test(t) && site) {
      await run('select_site', { site_id: site.id });
      return `Best match: ${site.name} (score ${site.score}). ${site.nearestSubstation.distanceM} m to ${site.nearestSubstation.name}. (offline mode)`;
    }
    return 'Gemini is unreachable right now — try “site A”, “2D”, “60 MW” or an agent name.';
  }

  // tools/system/state are shared with other front-ends (e.g. agents/voice.js) so every input drives the same actions
  return { send, reset: () => { history.length = 0; generation++; }, tools: allTools, system: SYSTEM, state: summariseState };
}

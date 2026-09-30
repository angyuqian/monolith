// Comms — drafts stakeholder communications from the site, design and other agents' findings.
// TEAMMATE: add channels (email via Gmail API, Slack, Docs export), translation (Malay/Chinese/Tamil), TTS briefings.
import { esc, md } from '../js/ui/toast.js';

const TYPES = {
  brief: { label: 'Stakeholder brief', prompt: 'an internal executive stakeholder brief with headings: Opportunity, Site, Design, Risks, Next steps' },
  community: { label: 'Community letter', prompt: 'a warm, plain-English letter to nearby residents and businesses explaining the project, noise/traffic mitigations and a contact point' },
  press: { label: 'Press release', prompt: 'a press release with headline, dateline Singapore, quote from the project lead, sustainability angle' },
  investor: { label: 'Investor one-pager', prompt: 'a crisp investor one-pager with key metrics, capex, efficiency and grid/fibre advantages' },
};
let type = 'brief';
const currentType = () => type;

function facts(ctx) {
  const s = ctx.store.get();
  const compliance = s.agents.compliance?.result;
  return {
    site: s.site && { name: s.site.name, score: s.site.score, substation: s.site.nearestSubstation, nearestDC: s.site.nearestDataCentre },
    design: s.design && { params: s.design.params, metrics: s.design.metrics },
    compliance: compliance && { status: compliance.status, summary: compliance.summary, checks: compliance.data?.checks },
    siteScout: s.agents.siteScout?.result?.summary,
  };
}

export default {
  id: 'comms',
  name: 'Comms',
  icon: '✉',
  color: '#5e8c61',
  stage: 'review',
  description: 'Drafts briefs, community letters and press releases.',

  mount(el, ctx) {
    el.innerHTML = `<div class="row">
      <select class="input grow" data-type>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <button class="btn btn--sm btn--primary" data-gen style="height:32px">Draft</button></div>`;
    el.querySelector('[data-type]').onchange = (e) => { type = e.target.value; };
    el.querySelector('[data-gen]').onclick = () => ctx.actions.runAgent('comms');
  },

  cacheVariant: (ctx, opts = {}) => `comms:${opts.type || type}`,

  async run(ctx, opts = {}) {
    const t = TYPES[opts.type] ? opts.type : type;
    const f = facts(ctx);
    if (!f.site) return { status: 'warn', summary: 'Select a site first.' };
    const res = await ctx.gemini.generate(
      `Write ${TYPES[t].prompt} for a proposed hyperscale data centre in Singapore. Max 220 words, markdown, no placeholders except [Name] for signatures. Use only these facts (numbers must match): ${JSON.stringify(f)}`,
      { temperature: 0.6 },
    );
    return { status: 'info', summary: `${TYPES[t].label} drafted for ${f.site.name.split(' · ')[1] || f.site.name}.`, data: { type: t, text: res.text } };
  },

  renderResult(el, result, ctx) {
    const text = result.data?.text;
    if (!text) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="doc">${md(text)}</div>
      <div class="row" style="margin-top:8px"><span class="muted grow" style="font-size:11px">${esc(TYPES[result.data.type]?.label || '')}</span>
      <button class="btn btn--sm" data-copy>Copy</button></div>`;
    el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(text).then(() => ctx.ui.toast('Copied to clipboard'));
  },

  fallback(ctx, opts = {}) {
    const type = TYPES[opts.type] ? opts.type : currentType();
    const f = facts(ctx);
    if (!f.site) return { status: 'warn', summary: 'Select a site first.' };
    const m = f.design?.metrics || {};
    const text = `## ${TYPES[type].label}: ${f.site.name}\n\n**Opportunity.** A ${m.itMW} MW hyperscale data centre at ${f.site.name.split(' · ')[1] || f.site.name}, with a site suitability score of ${f.site.score.toFixed(0)}/100.\n\n**Design.** ${m.gfaM2?.toLocaleString()} m² GFA, ${m.heightM} m tall, design PUE ${m.pue}, about ${m.energyGWh} GWh/yr.\n\n**Grid and fibre.** ${f.site.substation.distanceM} m to ${f.site.substation.name}; ${f.site.nearestDC.distanceM} m to the nearest data centre.\n\n**Next steps.**\n- Pre-application consultation with URA and IMDA\n- Grid connection study with SP Group\n- Community engagement session\n\n[Name], Project Lead`;
    return { status: 'info', summary: `${TYPES[type].label} drafted (template).`, data: { type, text } };
  },

  tools: [
    {
      name: 'draft_comms',
      description: `Draft a communication for the current proposal. Types: ${Object.entries(TYPES).map(([k, v]) => `${k} (${v.label})`).join(', ')}.`,
      parameters: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(TYPES) } }, required: ['type'] },
      handler: async ({ type: t }, ctx) => {
        const r = await ctx.actions.runAgent('comms', { type: t });
        return { status: r.status, summary: r.summary, text: r.data?.text };
      },
    },
  ],
};

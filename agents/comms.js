// Comms — drafts stakeholder communications from the site, design and other agents' findings.
// Investor memo → email pipeline: Gemini drafts subject + body, the compose window opens with the render,
// flythrough and compliance summary attached, and the presenter presses Send (pretend-send; see lib/compose.js).
// Recipient comes from CONFIG.COMMS (real address lives in config.local.js). Drafts use {{placeholders}}
// so cached drafts never contain a real name.
// TEAMMATE: add channels (Gmail API, Slack, Docs export), translation (Malay/Chinese/Tamil), TTS briefings.
import { CONFIG } from '../config.js';
import { cacheKeys } from '../js/core/cache.js';
import { esc, md } from '../js/ui/toast.js';
import { openCompose, closeCompose } from './lib/compose.js';

const TYPES = {
  brief: { label: 'Stakeholder brief', prompt: 'an internal executive stakeholder brief with headings: Opportunity, Site, Design, Risks, Next steps' },
  community: { label: 'Community letter', prompt: 'a warm, plain-English letter to nearby residents and businesses explaining the project, noise/traffic mitigations and a contact point' },
  press: { label: 'Press release', prompt: 'a press release with headline, dateline Singapore, quote from the project lead, sustainability angle' },
  investor: { label: 'Investor memo (email)', email: true },
};
let type = 'brief';
const currentType = () => type;

const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'specific subject line under 90 characters, include MW and location' },
    body: { type: 'string', description: 'markdown email body' },
  },
  required: ['subject', 'body'],
};

const recipient = () => CONFIG.COMMS?.recipient || { name: 'Investor', org: 'Investment firm', email: '' };

// {{first_name}} / {{name}} / {{org}} / {{sender}} -> configured values
function fill(text) {
  const r = recipient();
  return String(text || '')
    .replaceAll('{{first_name}}', r.name.split(/\s+/)[0])
    .replaceAll('{{name}}', r.name)
    .replaceAll('{{org}}', r.org)
    .replaceAll('{{sender}}', CONFIG.COMMS?.sender || 'The Monolith team');
}

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

const shortSite = (site) => (site?.name.split(' · ')[1] || site?.name || 'site');
const fileSafe = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');

// Attach whatever renders exist for the current design (cached / pre-rendered), plus the compliance summary.
async function gatherAttachments(ctx) {
  const { site, design, agents } = ctx.store.get();
  const base = `Monolith_${fileSafe(shortSite(site))}`;
  const find = async (kind) => {
    for (const s of ['dusk', 'day', 'night']) {
      const r = await ctx.cache.peek(cacheKeys({ agentId: 'render', variant: `${kind}:${s}`, site, params: design?.params }));
      if (r?.media?.type === kind) return r.media;
    }
    const last = agents.render?.result;
    return last?.media?.type === kind && !last.offline ? last.media : null;
  };
  const out = [];
  const img = await find('image');
  if (img) out.push({ kind: 'image', name: `${base}_render.jpg`, src: img.src, meta: 'Concept render' });
  const vid = await find('video');
  if (vid) out.push({ kind: 'video', name: `${base}_flythrough.mp4`, src: vid.src, meta: 'Flythrough · 10 s' });
  const c = agents.compliance?.result;
  if (c?.data?.checks) out.push({ kind: 'doc', name: 'Compliance_summary.pdf', meta: `${c.data.checks.length} checks · ${c.status}` });
  return out;
}

async function composeInvestorEmail(ctx, result) {
  const r = recipient();
  openCompose(ctx, {
    to: r,
    subject: fill(result.data.subject),
    bodyHtml: md(fill(result.data.text)),
    attachments: await gatherAttachments(ctx),
    onSent: (draft) => ctx.actions.runTask('comms', async () => ({
      status: 'pass',
      summary: `Investor memo sent to ${r.name} (${r.org}).`,
      data: { ...result.data, subject: draft.subject, sentText: draft.bodyText, sent: true, sentAt: Date.now() },
    }), null, { cache: false }),
  });
}

function investorPrompt(f, location) {
  return `Write a concise investor outreach email proposing investment consideration in a hyperscale data centre development in Singapore.
Use these literal placeholders and never real names: {{first_name}} (recipient's first name), {{org}} (their firm), {{sender}} (sign-off).
Do not state or guess anything about {{org}}'s portfolio, strategy or past deals.
Structure (markdown, no headings, body max 190 words):
- "Hi {{first_name}}," then a one-sentence hook
- 4-6 bullets of key metrics: IT capacity, estimated capex, design PUE, site suitability score, grid and fibre proximity, compliance status
- one or two sentences on why now (Singapore's DC-CFA capacity allocation is scarce and efficiency-gated)
- the ask: a 30-minute call next week; mention the attached concept render, flythrough and compliance summary
- sign off "Best regards,\\n{{sender}}"
Refer to the site by its location "${location}" (not "Site A" etc.).
Use only these facts; numbers must match exactly: ${JSON.stringify(f)}`;
}

export default {
  id: 'comms',
  name: 'Comms',
  icon: '✉',
  color: '#5e8c61',
  stage: 'review',
  description: 'Drafts briefs, letters, press releases and investor emails.',

  mount(el, ctx) {
    el.innerHTML = `<div class="row">
      <select class="input grow" data-type>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <button class="btn btn--sm btn--primary" data-gen style="height:32px">Draft</button></div>`;
    el.querySelector('[data-type]').onchange = (e) => { type = e.target.value; };
    el.querySelector('[data-gen]').onclick = async () => {
      const r = await ctx.actions.runAgent('comms');
      if (TYPES[r?.data?.type]?.email && r.data.subject) composeInvestorEmail(ctx, r);
    };
  },

  cacheVariant: (ctx, opts = {}) => `comms:${opts.type || type}`,

  async run(ctx, opts = {}) {
    const t = TYPES[opts.type] ? opts.type : type;
    const f = facts(ctx);
    if (!f.site) return { status: 'warn', summary: 'Select a site first.' };
    if (TYPES[t].email) {
      const res = await ctx.gemini.generateJSON(investorPrompt(f, shortSite(ctx.getSite())), EMAIL_SCHEMA, { temperature: 0.5 });
      return { status: 'info', summary: `Investor memo drafted for ${shortSite(ctx.getSite())} — ready to email.`, data: { type: t, subject: res.subject, text: res.body } };
    }
    const res = await ctx.gemini.generate(
      `Write ${TYPES[t].prompt} for a proposed hyperscale data centre in Singapore. Max 220 words, markdown, no placeholders except [Name] for signatures. Use only these facts (numbers must match): ${JSON.stringify(f)}`,
      { temperature: 0.6 },
    );
    return { status: 'info', summary: `${TYPES[t].label} drafted for ${shortSite(ctx.getSite())}.`, data: { type: t, text: res.text } };
  },

  renderResult(el, result, ctx) {
    const d = result.data;
    if (!d?.text) { el.innerHTML = ''; return; }
    const isEmail = TYPES[d.type]?.email;
    const r = recipient();
    const sent = d.sent ? `<span class="sent-badge">✓ Sent to ${esc(r.name)} · ${new Date(d.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : '';
    el.innerHTML = `${isEmail ? `<div class="muted" style="font-size:11.5px;margin-bottom:6px">To ${esc(r.name)} · ${esc(r.org)}<br><b style="color:var(--ink)">${esc(fill(d.subject))}</b></div>` : ''}
      <div class="doc">${md(fill(d.text))}</div>
      <div class="row" style="margin-top:8px">
        <span class="grow" style="font-size:11px">${sent || `<span class="muted">${esc(TYPES[d.type]?.label || '')}</span>`}</span>
        ${isEmail ? `<button class="btn btn--sm btn--primary" data-compose>✉ ${d.sent ? 'Resend' : 'Compose email'}</button>` : ''}
        <button class="btn btn--sm" data-copy>Copy</button>
      </div>`;
    el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(fill(d.text)).then(() => ctx.ui.toast('Copied to clipboard'));
    el.querySelector('[data-compose]')?.addEventListener('click', () => composeInvestorEmail(ctx, result));
  },

  fallback(ctx, opts = {}) {
    const type = TYPES[opts.type] ? opts.type : currentType();
    const f = facts(ctx);
    if (!f.site) return { status: 'warn', summary: 'Select a site first.' };
    const m = f.design?.metrics || {};
    const where = shortSite(ctx.getSite());
    if (TYPES[type].email) {
      const text = `Hi {{first_name}},\n\nWe're developing a ${m.itMW} MW hyperscale data centre at ${where}, Singapore, and would value {{org}}'s consideration as an investment partner.\n\n- **${m.itMW} MW** critical IT load, **${m.pue}** design PUE\n- Estimated capex **US$${m.capexUSDm}M**\n- Site suitability **${f.site.score.toFixed(0)}/100**\n- **${f.site.substation.distanceM} m** to ${f.site.substation.name}; **${f.site.nearestDC.distanceM} m** to the nearest data centre\n\nSingapore allocates new data-centre capacity competitively and only to best-in-class efficiency, so well-sited, low-PUE projects are scarce.\n\nWould you have 30 minutes next week? The concept render, flythrough and compliance summary are attached.\n\nBest regards,\n{{sender}}`;
      return { status: 'info', summary: `Investor memo drafted for ${where} (template) — ready to email.`, data: { type, subject: `Investment opportunity: ${m.itMW} MW hyperscale data centre, ${where}, Singapore`, text } };
    }
    const text = `## ${TYPES[type].label}: ${f.site.name}\n\n**Opportunity.** A ${m.itMW} MW hyperscale data centre at ${where}, with a site suitability score of ${f.site.score.toFixed(0)}/100.\n\n**Design.** ${m.gfaM2?.toLocaleString()} m² GFA, ${m.heightM} m tall, design PUE ${m.pue}, about ${m.energyGWh} GWh/yr.\n\n**Grid and fibre.** ${f.site.substation.distanceM} m to ${f.site.substation.name}; ${f.site.nearestDC.distanceM} m to the nearest data centre.\n\n**Next steps.**\n- Pre-application consultation with URA and IMDA\n- Grid connection study with SP Group\n- Community engagement session\n\n[Name], Project Lead`;
    return { status: 'info', summary: `${TYPES[type].label} drafted (template).`, data: { type, text } };
  },

  reset() {
    closeCompose();
  },

  tools: [
    {
      name: 'draft_comms',
      description: `Draft a communication for the current proposal. Types: ${Object.entries(TYPES).map(([k, v]) => `${k} (${v.label})`).join(', ')}.`,
      parameters: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(TYPES) } }, required: ['type'] },
      handler: async ({ type: t }, ctx) => {
        const r = await ctx.actions.runAgent('comms', { type: t });
        return { status: r.status, summary: r.summary, text: fill(r.data?.text) };
      },
    },
    {
      name: 'email_investor_memo',
      description: `Draft the investor memo email to ${recipient().name} (${recipient().org}) and open it in the email composer with the renders and compliance summary attached, for the presenter to review and press Send. This does NOT send the email.`,
      parameters: { type: 'object', properties: {} },
      handler: async (args, ctx) => {
        const r = await ctx.actions.runAgent('comms', { type: 'investor' });
        if (!r?.data?.subject) return { status: r?.status || 'error', summary: r?.summary };
        await composeInvestorEmail(ctx, r);
        return { status: 'draft_open', note: `The email to ${recipient().name} is open for the presenter to review and send. It has NOT been sent — do not say it was sent.` };
      },
    },
  ],
};

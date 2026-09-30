// Compliance — deterministic checks on the design metrics, extended and explained by Gemini
// against Singapore's regulatory context (URA, IMDA/EDB DC-CFA, BCA Green Mark, NEA, SCDF, PUB).
// TEAMMATE: plug in real rule sources (URA Master Plan zoning API, setback tables, noise limits) here.
import { esc } from '../js/ui/toast.js';

function localChecks(site, design) {
  const m = design.metrics;
  const b = site.breakdown;
  const sub = site.nearestSubstation.distanceM;
  const c = (rule, authority, status, detail) => ({ rule, authority, status, detail });
  return [
    c('Power usage effectiveness', 'IMDA / EDB · DC-CFA', m.pue <= 1.3 ? 'pass' : 'fail', `Design PUE ${m.pue} vs ≤ 1.30 required for DC-CFA capacity allocation.`),
    c('Plot ratio', 'URA · Business 2', m.plotRatio <= 2.5 ? 'pass' : 'warn', `Plot ratio ${m.plotRatio} vs typical B2 GPR of 2.5.`),
    c('Building height', 'URA · height control', m.heightM <= 50 ? 'pass' : 'warn', `${m.heightM} m. Heights above ~50 m in industrial estates usually need a URA/CAAS height review.`),
    c('Grid connection', 'SP Group / EMA', sub <= 2000 ? 'pass' : sub <= 4000 ? 'warn' : 'fail', `${sub} m to ${site.nearestSubstation.name}. ${m.facilityMW} MW facility load needs a dedicated 66 kV+ intake.`),
    c('Residential buffer', 'NEA · noise and air', b.community >= 70 ? 'pass' : 'warn', `Community buffer score ${b.community}/100; ${m.gensets} standby gensets need noise and emissions assessment.`),
    c('Water efficiency', 'PUB', m.wue <= 1.0 ? 'pass' : 'warn', `WUE ${m.wue} L/kWh, about ${Math.round(m.waterM3 / 1000)}k m³/yr. NEWater supply is recommended above 0.5 L/kWh.`),
  ];
}

function overall(checks) {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'max 35 words, lead with the verdict' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          authority: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
          detail: { type: 'string', description: 'max 25 words, cite the number' },
        },
        required: ['rule', 'authority', 'status', 'detail'],
      },
    },
  },
  required: ['summary', 'checks'],
};

export default {
  id: 'compliance',
  name: 'Compliance',
  icon: '⚖',
  color: '#7b5ea7',
  stage: 'review',
  description: 'Checks zoning, DC-CFA efficiency, grid, noise and water rules.',

  async run(ctx) {
    const site = ctx.getSite();
    const design = ctx.getDesign();
    if (!site || !design) return { status: 'warn', summary: 'Select a site and design first.' };
    const base = localChecks(site, design);
    const res = await ctx.gemini.generateJSON(
      `You are a Singapore data-centre regulatory consultant. Here are deterministic checks computed from the design. Keep their statuses (never contradict the numbers), sharpen their detail text, and add 2-3 more relevant checks (e.g. SCDF fire safety for battery/UPS rooms, BCA Green Mark Platinum, diesel storage licensing, URA B2 use-class, carbon reporting).
The summary verdict must match the worst status across all checks: any fail = "not compliant", any warn = "compliant with advisories", else "compliant".
Site: ${JSON.stringify({ name: site.name, lat: site.lat, lng: site.lng, breakdown: site.breakdown })}
Design params: ${JSON.stringify(design.params)}
Metrics: ${JSON.stringify(design.metrics)}
Deterministic checks: ${JSON.stringify(base)}`,
      SCHEMA,
    );
    // guarantee deterministic statuses survive
    const checks = res.checks.map((c) => {
      const b = base.find((x) => x.rule.toLowerCase() === c.rule.toLowerCase());
      return b ? { ...c, status: b.status } : c;
    });
    return { status: overall(checks), summary: res.summary, data: { checks } };
  },

  renderResult(el, result) {
    const checks = result.data?.checks || [];
    const icon = { pass: '✓', warn: '!', fail: '✕' };
    el.innerHTML = `<div class="checks">${checks.map((c) => `
      <div class="check">
        <span class="pill pill--${c.status}" style="padding:0 6px">${icon[c.status] || '·'}</span>
        <div><div class="check__rule">${esc(c.rule)} <span class="check__auth">· ${esc(c.authority)}</span></div></div>
        <div class="check__detail">${esc(c.detail)}</div>
      </div>`).join('')}</div>`;
  },

  fallback(ctx) {
    const site = ctx.getSite();
    const design = ctx.getDesign();
    if (!site || !design) return { status: 'warn', summary: 'Select a site and design first.' };
    const checks = localChecks(site, design);
    const st = overall(checks);
    const n = (s) => checks.filter((c) => c.status === s).length;
    return { status: st, summary: `${n('pass')} pass, ${n('warn')} to review, ${n('fail')} blocking. ${st === 'fail' ? 'Resolve the failures before a DC-CFA submission.' : 'Ready for pre-application discussion.'}`, data: { checks } };
  },
};

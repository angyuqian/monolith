// Site Scout — ranks the pre-scored candidate sites with Gemini and explains the trade-offs.
import { esc } from '../js/ui/toast.js';

const SCHEMA = {
  type: 'object',
  properties: {
    recommended_site_id: { type: 'string' },
    headline: { type: 'string', description: 'one sentence recommendation, max 30 words' },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          rationale: { type: 'string', description: 'max 22 words' },
        },
        required: ['site_id', 'rationale'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['recommended_site_id', 'headline', 'ranking'],
};

const brief = (s) => ({ id: s.id, name: s.name, score: s.score, breakdown: s.breakdown, substation: s.nearestSubstation, nearestDC: s.nearestDataCentre });

export default {
  id: 'siteScout',
  name: 'Site Scout',
  icon: '⌖',
  color: '#e8613c',
  stage: 'site',
  description: 'Ranks candidate sites on power, fibre, land and community impact.',
  cacheScope: 'global', // ranks all sites, so the result doesn't depend on the selected site

  async run(ctx) {
    const sites = ctx.store.get().sites;
    const res = await ctx.gemini.generateJSON(
      `You are a data-centre site-selection analyst in Singapore. Rank the top 3 of these candidate sites for a 40-80 MW hyperscale facility.
Scores are 0-100 (land = industrial land share, power = proximity to grid substation, fibre = proximity to existing DC cluster, community = buffer from housing).
Consider Singapore context (east has Loyang/Changi DC cluster and subsea cable landings; west has Jurong/Tuas industrial land; 400kV substations are strongest connections).
Candidates: ${JSON.stringify(sites.map(brief))}`,
      SCHEMA,
    );
    return { status: 'info', summary: res.headline, data: res };
  },

  renderResult(el, result, ctx) {
    const { ranking = [], risks = [] } = result.data || {};
    const sites = ctx.store.get().sites;
    el.innerHTML = `<div class="checks">${ranking.slice(0, 3).map((r, i) => {
      const s = sites.find((x) => x.id === r.site_id);
      if (!s) return '';
      return `<div class="check" style="grid-template-columns:auto 1fr auto">
        <span class="site-badge" style="width:24px;height:24px;font-size:11px">${i + 1}</span>
        <div><div class="check__rule">${esc(s.name)}</div><div class="check__detail" style="grid-column:auto">${esc(r.rationale)}</div></div>
        <button class="btn btn--sm" data-fly="${s.id}">Go</button></div>`;
    }).join('')}</div>
    ${risks.length ? `<div class="muted" style="font-size:11.5px;margin-top:8px"><b>Risks:</b> ${risks.map(esc).join(' · ')}</div>` : ''}`;
    el.onclick = (e) => { const b = e.target.closest('[data-fly]'); if (b) ctx.actions.selectSite(b.dataset.fly); };
  },

  fallback(ctx) {
    const sites = [...ctx.store.get().sites].sort((a, b) => b.score - a.score);
    const top = sites[0];
    return {
      status: 'info',
      summary: `${top.name} leads with a ${top.score.toFixed(0)} score: ${top.nearestSubstation.distanceM} m from ${top.nearestSubstation.name} and inside an established DC cluster.`,
      data: {
        recommended_site_id: top.id,
        ranking: sites.slice(0, 3).map((s) => ({ site_id: s.id, rationale: `Power ${s.breakdown.power}, fibre ${s.breakdown.fibre}, community buffer ${s.breakdown.community}.` })),
        risks: ['Grid capacity allocation from SP Group', 'DC-CFA capacity is allocated competitively'],
      },
    };
  },
};

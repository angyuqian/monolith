// Left panel: one view per workflow stage — 01 Site, 02 Design, 03 Review.
import { store } from '../core/store.js';
import { bus, EVENTS } from '../core/bus.js';
import { registry } from '../core/registry.js';
import { PARAM_LIMITS } from '../design/massing.js';
import { esc } from './toast.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}<small> km</small>` : `${fmt(m)}<small> m</small>`);
const BAR_COLORS = { land: '#e9b454', power: '#7b5ea7', fibre: '#e8613c', community: '#5e8c61' };
const BAR_LABELS = { land: 'Industrial land', power: 'Grid power', fibre: 'Fibre / DC cluster', community: 'Community buffer' };

export function initLeftPanel(ctx) {
  const el = document.getElementById('left-panel');
  const { actions } = ctx;
  let rendered = { stage: null, siteId: null };

  const head = (n, eyebrow, title, sub) => `
    <div class="panel__head">
      <div class="panel__eyebrow"><i>${n}</i>${eyebrow}</div>
      <div class="panel__title">${title}</div>
      <div class="panel__sub">${sub}</div>
    </div>`;

  // ---------- 01 Site ----------
  function siteView(s) {
    const site = s.site;
    const detail = site ? `
      <div class="card site-detail">
        <div class="site-detail__top">
          <div class="site-detail__score">${site.score.toFixed(0)}<small>/ 100 suitability</small></div>
          <div class="grow">
            <div style="font-weight:600">${esc(site.name)}</div>
            <div class="muted mono" style="font-size:11px">${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}</div>
          </div>
        </div>
        <div class="bars">
          ${Object.entries(site.breakdown).map(([k, v]) => `
            <div><div class="bar__head"><span>${BAR_LABELS[k]}</span><span>${v}</span></div>
            <div class="bar__track"><div class="bar__fill" style="width:${v}%;background:${BAR_COLORS[k]}"></div></div></div>`).join('')}
        </div>
        <div class="facts">
          <div class="fact"><div class="fact__label">To substation</div><div class="fact__value">${dist(site.nearestSubstation.distanceM)}</div></div>
          <div class="fact"><div class="fact__label">To nearest DC</div><div class="fact__value">${dist(site.nearestDataCentre.distanceM)}</div></div>
          ${site.custom ? '' : `<div class="fact fact--wide"><div class="fact__label">Grid connection</div><div class="fact__value fact__value--text">${esc(site.nearestSubstation.name)}</div></div>`}
        </div>
        <button class="btn btn--primary btn--block" style="margin-top:12px" data-go="design">Design on this site →</button>
      </div>` : `
      <div class="empty" style="margin-bottom:14px">
        <div class="empty__title">Pick a site to evaluate</div>
        Choose a candidate below, click any orange cell on the map, or ask Monolith in the command bar.
      </div>`;
    return `
      ${head('01', 'Site selection', 'Find a site', 'Scored on industrial land, grid power, fibre and community impact across 118k buildings.')}
      <div class="panel__body">
        ${detail}
        <div class="row" style="margin:18px 4px 8px"><div class="section-label grow" style="margin:0">Candidate sites</div>
          <button class="btn btn--sm btn--ghost" data-run="siteScout">✦ Rank with AI</button></div>
        ${s.sites.map((x, i) => `
          <button class="site-item ${site?.id === x.id ? 'is-active' : ''}" data-site="${x.id}">
            <span class="site-badge">${String.fromCharCode(65 + i)}</span>
            <span style="min-width:0"><div class="site-item__name">${esc(x.name.split(' · ')[1] || x.name)}</div>
            <div class="site-item__meta">${dist(x.nearestSubstation.distanceM).replace(/<[^>]+>/g, '')} to substation</div></span>
            <span class="score">${x.score.toFixed(0)}</span>
          </button>`).join('')}
      </div>`;
  }

  // ---------- 02 Design ----------
  const slider = (key, label, unit, p) => {
    const [min, max, step] = PARAM_LIMITS[key];
    return `<div class="control"><div class="control__head"><span class="control__label">${label}</span><span class="control__value" data-val="${key}">${p[key]}${unit}</span></div>
      <input type="range" data-param="${key}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${p[key]}"></div>`;
  };
  const seg = (key, label, options, p) => `<div class="control"><div class="control__head"><span class="control__label">${label}</span></div>
    <div class="seg" data-seg="${key}">${options.map(([v, l]) => `<button data-v="${v}" class="${p[key] === v ? 'is-active' : ''}">${l}</button>`).join('')}</div></div>`;

  function designView(s) {
    if (!s.site || !s.design) {
      return `${head('02', 'Design', 'Parametric massing', 'Generate a data centre on your chosen site.')}
        <div class="panel__body"><div class="empty"><div class="empty__title">No site selected</div>Pick a site first — the massing is generated on it automatically.
        <div style="margin-top:12px"><button class="btn" data-go="site">← Choose a site</button></div></div></div>`;
    }
    const p = s.design.params;
    return `
      ${head('02', 'Design', esc(s.site.name.split(' · ')[1] || s.site.name), 'Tune the programme — massing, yard and metrics update live.')}
      <div class="panel__body">
        <div class="section-label">Programme</div>
        ${slider('itMW', 'IT load', ' MW', p)}
        ${slider('halls', 'Data halls', '', p)}
        ${slider('storeys', 'Storeys', '', p)}
        ${seg('cooling', 'Cooling', [['liquid', 'Direct liquid'], ['air', 'Air / evaporative']], p)}
        ${seg('redundancy', 'Redundancy', [['N+1', 'N+1'], ['2N', '2N']], p)}
        <div class="section-label">Parcel</div>
        ${slider('parcelW', 'Width', ' m', p)}
        ${slider('parcelD', 'Depth', ' m', p)}
        ${slider('rotation', 'Rotation', '°', p)}
        <div class="section-label">Performance</div>
        <div id="design-warnings"></div>
        <div class="metrics" id="design-metrics"></div>
        <button class="btn btn--primary btn--block" style="margin-top:14px" data-go="review">Review with agents →</button>
      </div>`;
  }

  function renderMetrics(s) {
    const box = el.querySelector('#design-metrics');
    if (!box || !s.design) return;
    const m = s.design.metrics;
    const item = (label, value, unit = '', accent = false) => `<div class="metric ${accent ? 'metric--accent' : ''}"><div class="metric__label">${label}</div><div class="metric__value">${value}<small>${unit}</small></div></div>`;
    box.innerHTML = [
      item('IT capacity', m.itMW, 'MW', true),
      item('Design PUE', m.pue.toFixed(2), '', m.pue <= 1.3),
      item('White space', fmt(m.whiteSpaceM2), 'm²'),
      item('Racks', fmt(m.racks), `@${m.rackKW}kW`),
      item('GFA', fmt(m.gfaM2), 'm²'),
      item('Height', m.heightM, 'm'),
      item('Plot ratio', m.plotRatio.toFixed(2)),
      item('Gensets', m.gensets, '× 2.5MW'),
      item('Energy', fmt(m.energyGWh), 'GWh/yr'),
      item('Water', fmt(Math.round(m.waterM3 / 1000)), 'k m³/yr'),
      item('Carbon', fmt(Math.round(m.carbonT / 1000)), 'kt CO₂/yr'),
      item('Capex (est.)', `$${fmt(m.capexUSDm)}`, 'M'),
    ].join('');
    const w = el.querySelector('#design-warnings');
    w.innerHTML = s.design.warnings.length
      ? s.design.warnings.map((t) => `<div class="notice notice--warn">⚠ ${esc(t)}</div>`).join('')
      : `<div class="notice notice--ok">✓ Programme fits the parcel${m.pue <= 1.3 ? ' and meets the DC-CFA PUE ≤ 1.3 target' : ''}.</div>`;
    el.querySelectorAll('[data-val]').forEach((v) => {
      const input = el.querySelector(`input[data-param="${v.dataset.val}"]`);
      v.textContent = `${s.design.params[v.dataset.val]}${input.dataset.unit}`;
      if (document.activeElement !== input) input.value = s.design.params[v.dataset.val]; // external edits (orchestrator)
    });
    el.querySelectorAll('[data-seg]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.v === s.design.params[g.dataset.seg])));
  }

  // ---------- 03 Review ----------
  function reviewView(s) {
    const agents = registry.visibleAgents();
    const m = s.design?.metrics;
    return `
      ${head('03', 'Review', 'Agent review', 'Specialist agents check, render and communicate the proposal.')}
      <div class="panel__body">
        ${s.site ? `
        <div class="card site-detail">
          <div class="site-detail__top">
            <div class="site-detail__score">${s.site.score.toFixed(0)}<small>site score</small></div>
            <div class="grow"><div style="font-weight:600">${esc(s.site.name)}</div>
            ${m ? `<div class="muted" style="font-size:12px">${m.itMW} MW · PUE ${m.pue} · ${m.heightM} m · ${fmt(m.gfaM2)} m² GFA</div>` : ''}</div>
          </div>
          <button class="btn btn--coral btn--block" data-runall>✦ Run all agents</button>
        </div>` : `<div class="empty" style="margin-bottom:12px"><div class="empty__title">No proposal yet</div>Select a site to review a proposal.</div>`}
        <div class="section-label">Agents</div>
        ${agents.map((a) => {
          const st = s.agents[a.id] || { status: 'idle' };
          const status = st.status === 'done' ? (st.result?.status || 'done') : st.status;
          return `<div class="review-agent" data-open="${a.id}" style="cursor:pointer">
            <span class="agent-icon" style="background:${a.color}1f;color:${a.color}">${a.icon}</span>
            <div class="grow"><div class="row"><b class="grow">${esc(a.name)}</b><span class="pill pill--${status}">${status}</span></div>
            <div class="review-agent__summary">${esc(st.result?.summary || a.description)}</div></div>
          </div>`;
        }).join('')}
        <div class="section-label">Handoff</div>
        <button class="btn btn--block" data-export>Copy project JSON</button>
      </div>`;
  }

  function render() {
    const s = store.get();
    el.innerHTML = s.stage === 'site' ? siteView(s) : s.stage === 'design' ? designView(s) : reviewView(s);
    rendered = { stage: s.stage, siteId: s.site?.id, hasDesign: !!s.design };
    if (s.stage === 'design') renderMetrics(s);
  }

  // events
  let raf = null;
  el.addEventListener('input', (e) => {
    const input = e.target.closest('input[data-param]');
    if (!input) return;
    const key = input.dataset.param;
    el.querySelector(`[data-val="${key}"]`).textContent = `${input.value}${input.dataset.unit}`;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => actions.setDesignParams({ [key]: Number(input.value) }));
  });
  el.addEventListener('click', (e) => {
    const t = e.target;
    const siteBtn = t.closest('[data-site]');
    if (siteBtn) return actions.selectSite(siteBtn.dataset.site);
    const go = t.closest('[data-go]');
    if (go) return actions.setStage(go.dataset.go);
    const segBtn = t.closest('[data-seg] button');
    if (segBtn) {
      const key = segBtn.parentElement.dataset.seg;
      segBtn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === segBtn));
      return actions.setDesignParams({ [key]: segBtn.dataset.v });
    }
    const run = t.closest('[data-run]');
    if (run) { bus.emit(EVENTS.AGENT_OPEN, { id: run.dataset.run }); return actions.runAgent(run.dataset.run); }
    if (t.closest('[data-runall]')) return actions.runAll();
    const open = t.closest('[data-open]');
    if (open) return bus.emit(EVENTS.AGENT_OPEN, { id: open.dataset.open });
    if (t.closest('[data-export]')) {
      const s = store.get();
      const payload = { site: s.site, design: s.design && { params: s.design.params, metrics: s.design.metrics, warnings: s.design.warnings }, agents: Object.fromEntries(Object.entries(s.agents).map(([k, v]) => [k, v.result && { status: v.result.status, summary: v.result.summary, data: v.result.data }])) };
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => ctx.ui.toast('Project JSON copied'));
    }
  });

  store.on('stage', render);
  store.on('site', () => { if (rendered.siteId !== store.get().site?.id) render(); });
  store.on('design', () => {
    const s = store.get();
    if (s.stage === 'design' && !rendered.hasDesign) render();
    else if (s.stage === 'design') renderMetrics(s);
    else if (s.stage === 'review') render();
  });
  store.on('agents', () => { if (store.get().stage === 'review') render(); });
  render();
}

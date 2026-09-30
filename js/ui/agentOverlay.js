// "Constellation" overlay: agent cards float over the map, linked by animated curves to a hub on the site.
import { store } from '../core/store.js';
import { bus, EVENTS } from '../core/bus.js';
import { registry } from '../core/registry.js';
import { esc } from './toast.js';

const CARD_W = 200;
const HUB_LIFT = 130; // hub floats above the site, joined by a stem
// slot anchors as fractions of the map stage (x, y); cards are clamped inside.
const SLOTS = [[0.02, 0.03], [0.98, 0.03], [0.02, 0.46], [0.98, 0.46], [0.5, 0.03], [0.98, 0.72]];

export function initAgentOverlay(ctx) {
  const root = document.getElementById('overlay');
  const stage = document.getElementById('map-stage');
  const agents = registry.visibleAgents();
  root.innerHTML = `<svg class="links"></svg>
    <div class="hub" hidden><div class="hub__mark"><span style="height:10px"></span><span style="height:17px"></span><span style="height:13px"></span></div></div>
    ${agents.map((a) => `
      <div class="agent-float" data-agent="${a.id}" hidden style="--c:${a.color}">
        <span class="agent-float__pin" style="color:${a.color}"></span>
        <div class="agent-float__head">
          <span class="agent-icon" style="background:${a.color}1f;color:${a.color}">${a.icon}</span>
          <span class="agent-float__name">${esc(a.name)}</span>
          <span class="pill pill--idle" data-pill>idle</span>
        </div>
        <div class="agent-float__body" data-body>${esc(a.description)}</div>
        <div class="agent-float__media" data-media></div>
      </div>`).join('')}`;
  const svg = root.querySelector('svg');
  const hub = root.querySelector('.hub');
  const cards = agents.map((a) => ({ agent: a, el: root.querySelector(`[data-agent="${a.id}"]`) }));

  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-agent]');
    if (card) bus.emit(EVENTS.AGENT_OPEN, { id: card.dataset.agent });
  });

  function visible() {
    const s = store.get();
    return s.constellation && !!s.site;
  }

  function layout() {
    const on = visible();
    hub.hidden = !on;
    cards.forEach((c) => { c.el.hidden = !on; });
    if (!on) { svg.innerHTML = ''; return; }
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const site = store.get().site;
    const ground = ctx.map.project([site.lng, site.lat]);
    const p = { x: ground.x, y: ground.y - HUB_LIFT };
    hub.style.left = `${p.x}px`;
    hub.style.top = `${p.y}px`;
    let paths = `<path class="link" stroke="#e8613c" stroke-dasharray="2 4" d="M${p.x},${p.y + 30} L${ground.x},${ground.y}"/><circle cx="${ground.x}" cy="${ground.y}" r="4" fill="#e8613c" stroke="#fff" stroke-width="2"/>`;
    cards.forEach((c, i) => {
      const [fx, fy] = SLOTS[i % SLOTS.length];
      const h = c.el.offsetHeight || 90;
      const x = Math.max(12, Math.min(W - CARD_W - 12, fx * W - (fx > 0.6 ? CARD_W : fx > 0.4 ? CARD_W / 2 : 0)));
      const y = Math.max(12, Math.min(H - h - 90, fy * H));
      c.el.style.left = `${x}px`;
      c.el.style.top = `${y}px`;
      // anchor on the card edge facing the hub
      const ax = x + CARD_W / 2 < p.x ? x + CARD_W : x;
      const ay = y + h / 2;
      const pin = c.el.querySelector('.agent-float__pin');
      pin.style.left = `${ax - x - 5}px`;
      pin.style.top = `${h / 2 - 5}px`;
      const mx = (ax + p.x) / 2;
      const st = store.get().agents[c.agent.id]?.status;
      paths += `<path class="link ${st === 'running' ? 'link--flow' : ''}" stroke="${c.agent.color}" stroke-dasharray="${st === 'running' ? '' : st === 'done' ? '' : '2 5'}" d="M${ax},${ay} C${mx},${ay} ${mx},${p.y} ${p.x},${p.y}"/>`;
    });
    svg.innerHTML = paths;
  }

  function syncCards() {
    const s = store.get();
    cards.forEach(({ agent, el }) => {
      const st = s.agents[agent.id] || { status: 'idle' };
      const status = st.status === 'done' ? (st.result?.status || 'done') : st.status;
      const pill = el.querySelector('[data-pill]');
      pill.className = `pill pill--${status}`;
      pill.textContent = status === 'running' ? 'working' : status;
      el.querySelector('[data-body]').textContent = st.status === 'running' ? 'Working…' : st.result?.summary || agent.description;
      const media = el.querySelector('[data-media]');
      const m = st.result?.media;
      const key = m ? m.src : '';
      if (media.dataset.key !== key) {
        media.dataset.key = key;
        media.innerHTML = !m ? '' : m.type === 'video'
          ? `<video src="${m.src}" autoplay muted loop playsinline></video>`
          : `<img src="${m.src}" alt="">`;
      }
    });
    layout();
  }

  bus.on(EVENTS.AUDIO_LEVEL, ({ level, source }) => { if (source === 'voice') hub.style.setProperty('--voice', level.toFixed(3)); });
  ctx.map.on('move', layout);
  window.addEventListener('resize', layout);
  store.on('agents', syncCards);
  store.on('constellation', layout);
  store.on('site', layout);
  new ResizeObserver(layout).observe(stage);
  syncCards();
}

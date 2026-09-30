// Right panel: registered agent cards + orchestrator chat.
import { CONFIG } from '../../config.js';
import { store } from '../core/store.js';
import { bus, EVENTS } from '../core/bus.js';
import { registry } from '../core/registry.js';
import { esc, md } from './toast.js';

const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const SUGGESTIONS = [
  'Find the best 60 MW site in the west',
  'Show me site A in 2D',
  'Make it 80 MW with liquid cooling',
  'Run compliance and draft a community letter',
];

export function initAgentHub(ctx, orchestrator) {
  const el = document.getElementById('right-panel');
  const agents = registry.visibleAgents();
  el.innerHTML = `
    <div class="hub-head">
      <div class="hub-head__mark">✦</div>
      <div class="grow"><div class="hub-head__title">Agent Hub</div>
      <div class="hub-head__sub">${agents.length} agents · orchestrated by ${CONFIG.MODELS.text}</div></div>
    </div>
    <div class="agents-list" id="agents-list">
      ${agents.map((a) => `
        <div class="agent-card" data-agent="${a.id}">
          <div class="agent-card__head">
            <span class="agent-icon" style="background:${a.color}1f;color:${a.color}">${a.icon}</span>
            <div class="grow"><div class="agent-card__name">${esc(a.name)}</div><div class="agent-card__desc">${esc(a.description)}</div></div>
            <span class="pill pill--idle" data-pill>idle</span>
            ${a.run ? `<button class="run-btn" data-run title="Run ${esc(a.name)}">${PLAY}</button>` : ''}
          </div>
          <div class="agent-card__body" hidden>
            <div class="agent-card__summary" data-summary></div>
            <div class="agent-card__custom" data-custom></div>
            <div class="agent-card__result" data-result></div>
          </div>
        </div>`).join('')}
    </div>
    <div class="chat">
      <div class="chat__log" id="chat-log"></div>
      <div class="chat__suggest" id="chat-suggest">${SUGGESTIONS.map((s) => `<button>${esc(s)}</button>`).join('')}</div>
      <form class="chat__form" id="chat-form">
        <textarea id="chat-input" placeholder="Message Monolith…" rows="1"></textarea>
        <button class="btn btn--primary" type="submit">Send</button>
      </form>
    </div>`;

  // mount agent custom UIs (isolated: one broken agent must not break the hub)
  agents.forEach((a) => {
    const card = el.querySelector(`[data-agent="${a.id}"]`);
    try { a.mount?.(card.querySelector('[data-custom]'), ctx); } catch (e) { console.warn(`[agent:${a.id}] mount failed`, e); }
  });

  const openCard = (id, open = true) => {
    const card = el.querySelector(`[data-agent="${id}"]`);
    if (!card) return;
    card.querySelector('.agent-card__body').hidden = !open;
    card.classList.toggle('is-open', open);
    if (open) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      card.classList.remove('is-flash');
      void card.offsetWidth;
      card.classList.add('is-flash');
    }
  };

  el.querySelector('#agents-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-agent]');
    if (!card) return;
    const id = card.dataset.agent;
    if (e.target.closest('[data-run]')) { openCard(id); ctx.actions.runAgent(id); return; }
    if (e.target.closest('.agent-card__head')) openCard(id, card.querySelector('.agent-card__body').hidden);
  });
  bus.on(EVENTS.AGENT_OPEN, ({ id }) => openCard(id));

  // agent status + results
  function syncAgents() {
    const s = store.get();
    agents.forEach((a) => {
      const st = s.agents[a.id] || { status: 'idle' };
      const card = el.querySelector(`[data-agent="${a.id}"]`);
      const status = st.status === 'done' ? (st.result?.status || 'done') : st.status;
      const pill = card.querySelector('[data-pill]');
      pill.className = `pill pill--${status}`;
      pill.textContent = status === 'running' ? 'working' : status;
      card.querySelector('[data-summary]').innerHTML = st.status === 'running'
        ? '<span class="row"><span class="spinner"></span> Working…</span>'
        : st.result ? esc(st.result.summary) + (st.result.offline ? ' <span class="muted">(demo output)</span>' : '') + (st.result.cached ? ' <span class="cached-tag" title="Served from the render cache">· cached</span>' : '') : '';
    });
  }
  store.on('agents', syncAgents);
  bus.on(EVENTS.AGENT_RESULT, ({ id, result }) => {
    const a = registry.agent(id);
    const card = el.querySelector(`[data-agent="${id}"]`);
    try { a.renderResult?.(card.querySelector('[data-result]'), result, ctx); } catch (e) { console.warn(`[agent:${id}] renderResult failed`, e); }
    openCard(id);
    post({ role: 'agent', agentId: id, text: result.summary });
  });
  bus.on(EVENTS.AGENT_STARTED, ({ id }) => openCard(id));

  // ---------- chat ----------
  const log = el.querySelector('#chat-log');
  const form = el.querySelector('#chat-form');
  const input = el.querySelector('#chat-input');
  const suggest = el.querySelector('#chat-suggest');

  function post({ role, text, agentId }) {
    const div = document.createElement('div');
    if (role === 'user') { div.className = 'msg msg--user'; div.textContent = text; }
    else if (role === 'tool') { div.className = 'tool-chip'; div.textContent = text; }
    else if (role === 'agent') {
      const a = registry.agent(agentId);
      div.className = 'msg msg--agent';
      div.innerHTML = `<div class="msg__who"><span class="agent-icon" style="width:18px;height:18px;font-size:10px;border-radius:5px;background:${a.color}1f;color:${a.color}">${a.icon}</span>${esc(a.name)}</div>${md(text || '')}`;
    } else { div.className = 'msg msg--ai'; div.innerHTML = md(text); }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  bus.on(EVENTS.CHAT_POST, post);

  let busy = false;
  let chatEpoch = 0; // bumped on reset so late replies from a previous session are dropped
  async function ask(text) {
    if (busy) return;
    busy = true;
    const epoch = chatEpoch;
    suggest.hidden = true;
    post({ role: 'user', text });
    const thinking = document.createElement('div');
    thinking.className = 'msg msg--ai msg--thinking';
    thinking.innerHTML = '<span class="spinner"></span> Thinking…';
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;
    try {
      const reply = await orchestrator.send(text, {
        onTool: (fc) => {
          const args = fc.args && Object.keys(fc.args).length ? ` ${JSON.stringify(fc.args)}` : '';
          log.insertBefore(Object.assign(document.createElement('div'), { className: 'tool-chip', textContent: `→ ${fc.name}${args}` }), thinking);
        },
      });
      thinking.remove();
      if (epoch === chatEpoch && reply) post({ role: 'ai', text: reply });
    } catch (e) {
      thinking.remove();
      if (epoch === chatEpoch) post({ role: 'ai', text: `Something went wrong: ${e.message}` });
    } finally {
      if (epoch === chatEpoch) busy = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  suggest.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });

  const WELCOME = 'Hi — I’m **Monolith**. I can find a site for your data centre, design it, and hand it to specialist agents for compliance checks, renders and stakeholder comms. Try a suggestion below or pick a site on the left.';
  bus.on(EVENTS.RESET, () => {
    orchestrator.reset();
    chatEpoch++;
    busy = false;
    log.innerHTML = '';
    suggest.hidden = false;
    agents.forEach((a) => {
      const card = el.querySelector(`[data-agent="${a.id}"]`);
      card.querySelector('[data-result]').innerHTML = '';
      openCard(a.id, false);
    });
    post({ role: 'ai', text: WELCOME });
    syncAgents();
  });

  post({ role: 'ai', text: WELCOME });
  ctx.ui.ask = ask;
  syncAgents();
}

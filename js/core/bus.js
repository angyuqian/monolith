// Tiny pub/sub for cross-module events. Agents should talk to each other through this, never via imports.
export const EVENTS = {
  MAP_READY: 'map:ready',
  SITE_SELECTED: 'site:selected',       // detail: site
  DESIGN_CHANGED: 'design:changed',     // detail: { params, metrics }
  AGENT_STARTED: 'agent:started',       // detail: { id }
  AGENT_RESULT: 'agent:result',         // detail: { id, result }
  AGENT_OPEN: 'agent:open',             // detail: { id }  (focus an agent card in the hub)
  CHAT_POST: 'chat:post',               // detail: { role, text, agentId? }
  RESET: 'app:reset',                   // demo reset: modules clear their own UI state
};

const target = new EventTarget();

export const bus = {
  on(type, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};

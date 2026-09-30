// Top bar (command bar, stage nav, API status), left rail and global keyboard shortcuts.
import { store } from '../core/store.js';
import { gemini } from '../core/gemini.js';
import { CONFIG, setGeminiKey } from '../../config.js';

export function initShell(ctx) {
  const { actions } = ctx;
  const app = document.getElementById('app');

  // stage nav
  const nav = document.getElementById('stage-nav');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-stage]');
    if (!b) return;
    actions.setStage(b.dataset.stage);
    store.set({ leftOpen: true });
  });

  // rail
  const rail = document.getElementById('rail');
  const layersPop = document.getElementById('layers-pop');
  rail.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rail]');
    if (!b) return;
    const key = b.dataset.rail;
    if (key === 'layers') layersPop.hidden = !layersPop.hidden;
    else if (key === 'constellation') store.set({ constellation: !store.get().constellation });
    else if (store.get().stage === key) store.set({ leftOpen: !store.get().leftOpen });
    else { actions.setStage(key); store.set({ leftOpen: true }); }
    syncRail();
  });

  function syncRail() {
    const s = store.get();
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.stage === s.stage));
    rail.querySelectorAll('button').forEach((b) => {
      const k = b.dataset.rail;
      const active = k === 'layers' ? !layersPop.hidden
        : k === 'constellation' ? s.constellation
          : s.leftOpen && s.stage === k;
      b.classList.toggle('is-active', active);
    });
    app.classList.toggle('left-collapsed', !s.leftOpen);
  }
  store.on('*', syncRail);
  syncRail();

  // left panel collapse changes map size
  store.on('leftOpen', () => setTimeout(() => ctx.map.map.resize(), 0));

  // command bar -> orchestrator (chat in the agent hub renders the conversation)
  const form = document.getElementById('command-form');
  const input = document.getElementById('command-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.blur();
    ctx.ui.ask(text);
  });

  // reset demo (keeps the render cache)
  const reset = () => {
    layersPop.hidden = true;
    document.getElementById('lightbox').hidden = true;
    input.value = '';
    actions.reset();
    ctx.ui.toast('Demo reset');
  };
  document.getElementById('reset-btn').addEventListener('click', reset);

  // keyboard
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); return; }
    if (e.key === 'Escape') {
      layersPop.hidden = true;
      document.getElementById('lightbox').hidden = true;
      if (typing) document.activeElement.blur();
      syncRail();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.shiftKey && e.key.toLowerCase() !== 'r') return;
    const k = e.key.toLowerCase();
    if (k === 'r' && e.shiftKey) return reset();
    if (k === 't') actions.setMode(store.get().mode === '3d' ? '2d' : '3d');
    if (k === 'o') ctx.map.orbit(!ctx.map.isOrbiting());
    if (k === 'l') { layersPop.hidden = !layersPop.hidden; syncRail(); }
    if (k === 'c') store.set({ constellation: !store.get().constellation });
    if (['1', '2', '3'].includes(k)) actions.setStage(['site', 'design', 'review'][+k - 1]);
  });

  // Gemini status
  const status = document.getElementById('api-status');
  const label = status.querySelector('.status__label');
  const check = () => {
    status.classList.remove('is-ok', 'is-err');
    if (!CONFIG.GEMINI_KEY) {
      status.classList.add('is-err');
      label.textContent = 'Add Gemini key';
      status.title = 'Click to enter a Gemini API key (cached demo results still work without one)';
      return;
    }
    label.textContent = 'Gemini';
    gemini.ping()
      .then(() => { status.classList.add('is-ok'); status.title = 'Gemini connected · click to change key'; })
      .catch((e) => { status.classList.add('is-err'); status.title = `Gemini unreachable: ${e.message} · click to change key`; label.textContent = 'Gemini offline'; });
  };
  status.addEventListener('click', () => {
    const key = window.prompt('Gemini API key (stored only in this browser):', CONFIG.GEMINI_KEY || '');
    if (key == null) return;
    setGeminiKey(key);
    check();
  });
  check();
}

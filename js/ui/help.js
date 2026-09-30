// Help panel: "?" in the top bar. Opens automatically on a visitor's first visit to the hosted site,
// so people can use Monolith on their own.
import { CONFIG, IS_HOSTED } from '../../config.js';
import { esc } from './toast.js';

const SEEN = 'monolith.helpSeen';
const TRY = [
  'Take me to Site D',
  'Find the best 60 MW site in the west, away from housing',
  'Make it 80 MW with air cooling',
  'Run the compliance check',
  'Email the investor memo',
];

export function initHelp(ctx) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm btn--ghost help-btn';
  btn.title = 'How to use Monolith';
  btn.textContent = '?';
  document.getElementById('reset-btn').before(btn);

  const box = document.createElement('div');
  box.className = 'help';
  box.hidden = true;
  box.innerHTML = `
    <div class="help__card card" role="dialog" aria-label="How to use Monolith">
      <button type="button" class="help__close" title="Close (Esc)">×</button>
      <div class="help__eyebrow">Welcome to</div>
      <h2 class="help__title">Monolith</h2>
      <p class="help__lead">Find a site in Singapore for a hyperscale data centre, design it, and let AI agents check, render and pitch it.</p>
      <ol class="help__steps">
        <li><b>Pick a site.</b> Click a lettered pin (A–H) or any orange cell. Darker cells are a better fit.</li>
        <li><b>Design it.</b> Open <i>02 Design</i> and drag the sliders; the building and its metrics update live. Press <kbd>T</kbd> for 2D/3D.</li>
        <li><b>Review.</b> Open <i>03 Review</i> and press <b>Run all agents</b> for compliance, renders and comms.</li>
      </ol>
      <div class="help__label">Or just ask, by typing or talking (tap 🎙 or hold <kbd>Space</kbd>):</div>
      <div class="help__try">${TRY.map((t) => `<button type="button">${esc(t)}</button>`).join('')}</div>
      <div class="help__grid">
        <div><b>Multiplayer</b><span>Press <kbd>M</kbd> to see live collaborator cursors.</span></div>
        <div><b>Renders take time</b><span>Images take about 15 s and flythroughs about 50 s. They start in the background when you pick a site.</span></div>
        <div><b>Start over</b><span><b>↺ Reset</b> in the top bar, or <kbd>Shift</kbd>+<kbd>R</kbd>.</span></div>
        <div><b>Shortcuts</b><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> stages · <kbd>O</kbd> orbit · <kbd>L</kbd> layers · <kbd>C</kbd> agent cards</span></div>
      </div>
      <div class="help__foot">
        <span class="help__status"></span>
        <button type="button" class="btn btn--primary btn--sm" data-start>Start exploring</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const status = box.querySelector('.help__status');
  const open = () => {
    status.textContent = CONFIG.GEMINI_KEY
      ? `AI: ${document.getElementById('api-status')?.textContent.trim() || 'Gemini'}`
      : 'AI features need a Gemini key: click the Gemini pill in the top bar.';
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('is-on'));
  };
  const close = () => {
    box.classList.remove('is-on');
    setTimeout(() => { box.hidden = true; }, 200);
    try { localStorage.setItem(SEEN, '1'); } catch { /* storage blocked */ }
  };

  btn.onclick = open;
  box.querySelector('.help__close').onclick = close;
  box.querySelector('[data-start]').onclick = close;
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('.help__try').onclick = (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    close();
    ctx.ui.ask(e.target.textContent);
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) close(); });

  let seen = false;
  try { seen = localStorage.getItem(SEEN) === '1'; } catch { /* show it */ }
  if (IS_HOSTED && !seen) setTimeout(open, 900);
}

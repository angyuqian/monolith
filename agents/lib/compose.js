// Email-style compose window for agents (used by Comms). Pretend-send only: nothing leaves the browser.
// "Open in Gmail" hands the draft to a real Gmail compose tab, where a person reviews and sends it.
import { esc } from '../../js/ui/toast.js';

const GMAIL_BODY_MAX = 1800; // compose URLs get unreliable beyond ~2k chars

let root = null;

function ensureRoot(stage) {
  if (root) return root;
  root = document.createElement('div');
  root.className = 'compose-layer';
  stage.appendChild(root);
  return root;
}

export function closeCompose() {
  root?.querySelector('.compose')?.remove();
  root?.querySelector('.snackbar')?.remove();
}

/**
 * openCompose(ctx, {
 *   to: { name, org, email }, subject, bodyHtml,
 *   attachments: [{ kind: 'image'|'video'|'doc', name, src?, meta? }],
 *   onSent({ subject, bodyText }), onUndo()
 * })
 */
export function openCompose(ctx, { to, subject, bodyHtml, attachments = [], onSent, onUndo }) {
  const layer = ensureRoot(ctx.ui.slots.stage);
  closeCompose();
  const initials = to.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const el = document.createElement('div');
  el.className = 'compose';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'New message');
  el.innerHTML = `
    <div class="compose__head">
      <span>New message</span>
      <div class="compose__head-actions">
        <button type="button" data-min title="Minimise">–</button>
        <button type="button" data-close title="Discard">×</button>
      </div>
    </div>
    <div class="compose__main">
      <div class="compose__row">
        <span class="compose__label">To</span>
        <span class="compose__chip"><span class="compose__avatar">${esc(initials)}</span>${esc(to.name)}${to.email ? ` <span class="muted">&lt;${esc(to.email)}&gt;</span>` : ` <span class="muted">· ${esc(to.org)}</span>`}</span>
      </div>
      <div class="compose__row">
        <input class="compose__subject" value="${esc(subject)}" aria-label="Subject">
      </div>
      <div class="compose__body doc" contenteditable="true" spellcheck="false">${bodyHtml}</div>
      ${attachments.length ? `<div class="compose__attachments">${attachments.map((a) => `
        <div class="compose__att" data-kind="${a.kind}" ${a.src ? `data-src="${esc(a.src)}"` : ''} title="${esc(a.name)}">
          ${a.kind === 'image' && a.src ? `<img src="${esc(a.src)}" alt="">` : a.kind === 'video' && a.src ? `<video src="${esc(a.src)}" muted playsinline></video><span class="compose__play">▶</span>` : '<span class="compose__doc">PDF</span>'}
          <div class="compose__att-meta"><b>${esc(a.name)}</b><span>${esc(a.meta || '')}</span></div>
        </div>`).join('')}</div>` : ''}
    </div>
    <div class="compose__foot">
      <button type="button" class="compose__send">Send</button>
      <button type="button" class="btn btn--sm btn--ghost" data-gmail title="Open this draft in a real Gmail compose window">Open in Gmail ↗</button>
    </div>`;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));

  const subjectInput = el.querySelector('.compose__subject');
  const body = el.querySelector('.compose__body');
  // plain text for Gmail: keep bullet markers that innerText drops
  const bodyText = () => {
    const copy = body.cloneNode(true);
    copy.querySelectorAll('li').forEach((li) => li.prepend('• '));
    copy.style.cssText = 'position:absolute;left:-9999px;white-space:pre-wrap';
    document.body.appendChild(copy);
    const text = copy.innerText;
    copy.remove();
    return text.replace(/\n{3,}/g, '\n\n').trim();
  };

  el.querySelector('[data-close]').onclick = () => el.remove();
  el.querySelector('[data-min]').onclick = () => el.classList.toggle('is-min');
  el.querySelector('.compose__head').ondblclick = () => el.classList.toggle('is-min');
  el.querySelectorAll('.compose__att[data-src]').forEach((a) => {
    a.onclick = () => ctx.ui.lightbox(a.dataset.src, a.dataset.kind === 'video' ? 'video' : 'image');
  });

  el.querySelector('[data-gmail]').onclick = () => {
    let text = bodyText();
    if (text.length > GMAIL_BODY_MAX) text = `${text.slice(0, GMAIL_BODY_MAX)}…`;
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to.email || '')}&su=${encodeURIComponent(subjectInput.value)}&body=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  };

  el.querySelector('.compose__send').onclick = async (e) => {
    const btn = e.currentTarget;
    const draft = { subject: subjectInput.value, bodyText: bodyText() };
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner--light"></span> Sending…';
    await new Promise((r) => setTimeout(r, 900));
    el.classList.remove('is-open');
    el.classList.add('is-sent');
    setTimeout(() => { el.hidden = true; }, 300);
    snackbar(layer, `Sending to ${to.name}…`, {
      undo: () => {
        el.hidden = false;
        el.classList.remove('is-sent');
        requestAnimationFrame(() => el.classList.add('is-open'));
        btn.disabled = false;
        btn.textContent = 'Send';
        onUndo?.();
      },
      done: () => {
        el.remove();
        snackbar(layer, `Message sent to ${to.name}`, { ms: 3500 });
        onSent?.(draft);
      },
    });
  };
  return el;
}

// Gmail-like snackbar with optional Undo window.
function snackbar(layer, text, { undo, done, ms = 3500 } = {}) {
  layer.querySelector('.snackbar')?.remove();
  const bar = document.createElement('div');
  bar.className = 'snackbar';
  bar.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  layer.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('is-on'));
  let undone = false;
  const timer = setTimeout(() => {
    bar.classList.remove('is-on');
    setTimeout(() => bar.remove(), 250);
    if (!undone) done?.();
  }, ms);
  if (undo) {
    bar.querySelector('button').onclick = () => {
      undone = true;
      clearTimeout(timer);
      bar.remove();
      undo();
    };
  }
}

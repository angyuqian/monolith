// Voice Copilot — talk to the map. Gemini Live (native audio) over a browser WebSocket.
// It reuses the orchestrator's tools, so anything the chat can do (and any teammate agent) works by voice.
//
// UI: mic in the command bar (tap to talk, or hold Space) + live captions over the map.
// Transcripts and tool calls are also posted to the chat feed.
import { CONFIG } from '../config.js';
import { toGeminiSchema } from '../js/core/gemini.js';
import { esc } from '../js/ui/toast.js';

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const VOICES = ['Puck', 'Kore', 'Charon', 'Aoede', 'Fenrir', 'Leda'];
const IN_RATE = 16000;         // Live API input: 16 kHz mono PCM16
const SLOW_TOOL_MS = 15000;    // long jobs (e.g. Omni video) answer "started" so the conversation keeps flowing
const MAX_TAP_MS = 15000;      // tap-to-talk auto-stops after this long
const REPLY_TIMEOUT_MS = 15000;

const MIC_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
const TITLES = {
  idle: 'Talk to Monolith — tap, or hold Space',
  connecting: 'Connecting…',
  listening: 'Listening — tap to stop',
  thinking: 'Thinking…',
  speaking: 'Speaking — tap to interrupt',
  error: 'Voice unavailable',
};

// Mic tap: posts raw Float32 frames to the main thread.
const WORKLET = `class MicTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('mic-tap', MicTap);`;

const settings = (() => {
  const d = { voice: 'Puck', speak: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem('monolith.voice') || '{}') }; } catch { return d; }
})();
const saveSettings = () => { try { localStorage.setItem('monolith.voice', JSON.stringify(settings)); } catch { /* storage blocked */ } };

let app = null;          // ctx
const ui = {};
let ws = null;
let ready = null;        // Promise<WebSocket> while connecting/connected
let state = 'idle';
let listening = false;
let holdMode = false;
let mic = null;          // { stream, ac, src, node }
let preBuffer = [];      // audio captured before the socket is ready
let player = null;       // { ac, gain, analyser, next, sources }
let turn = null;
let timers = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshTurn = () => ({ inText: '', outText: '', postedUser: false, done: false, responded: false, toolRound: false });

function setState(s, title) {
  state = s;
  if (!ui.btn) return;
  ui.btn.dataset.state = s;
  ui.btn.title = title || TITLES[s];
}

function send(msg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------- session
function setupMessage() {
  const o = app.orchestrator;
  return {
    model: `models/${CONFIG.MODELS.live}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } },
    },
    systemInstruction: {
      parts: [{
        text: `${o.system}
You are speaking out loud during a live demo. Answer in one or two short spoken sentences. No markdown, no lists, no site IDs — say site names. Call get_state whenever you need the current site, design or agent results.
Current app state: ${JSON.stringify(o.state())}`,
      }],
    },
    tools: [{
      functionDeclarations: o.tools().map((t) => ({
        name: t.name,
        description: t.description,
        ...(Object.keys(t.parameters?.properties || {}).length ? { parameters: toGeminiSchema(t.parameters) } : {}),
      })),
    }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

function connect() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    if (!CONFIG.GEMINI_KEY) { reject(new Error('no Gemini API key')); return; }
    const sock = new WebSocket(`${WS_URL}?key=${encodeURIComponent(CONFIG.GEMINI_KEY)}`);
    ws = sock;
    const timer = setTimeout(() => { reject(new Error('connection timed out')); sock.close(); }, 10000);
    sock.onopen = () => sock.send(JSON.stringify({ setup: setupMessage() }));
    sock.onmessage = async (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
      if (m.setupComplete) { clearTimeout(timer); resolve(sock); return; }
      onMessage(m);
    };
    sock.onclose = (e) => {
      clearTimeout(timer);
      reject(new Error(e.reason || 'connection closed'));
      if (ws !== sock) return;
      ws = null;
      ready = null;
      if (listening || state === 'thinking') {
        stopMic();
        listening = false;
        fail(`Voice disconnected${e.reason ? `: ${e.reason}` : ''}`);
      }
    };
  });
  ready.catch(() => { ready = null; });
  return ready;
}

function closeSession() {
  const s = ws;
  ws = null;
  ready = null;
  try { s?.close(); } catch { /* already closed */ }
}

// ---------------------------------------------------------------- server messages
function onMessage(m) {
  if (m.goAway) closeSession();
  if (m.toolCall) { markResponded(); handleTools(m.toolCall.functionCalls || []); }
  const sc = m.serverContent;
  if (!sc || !turn) return;
  if (sc.inputTranscription?.text) {
    turn.inText += sc.inputTranscription.text;
    caption('user', turn.inText);
  }
  if (sc.outputTranscription?.text) {
    markResponded();
    turn.outText += sc.outputTranscription.text;
    caption('ai', turn.outText);
  }
  for (const p of sc.modelTurn?.parts || []) {
    if (p.inlineData?.mimeType?.startsWith('audio/')) {
      markResponded();
      play(p.inlineData.data, +(p.inlineData.mimeType.match(/rate=(\d+)/)?.[1] || 24000));
    }
  }
  if (sc.interrupted) stopPlayback();
  if (sc.turnComplete) finishTurn();
}

// First sign the model is answering: end the user's turn (tap mode) and log what they said.
function markResponded() {
  if (!turn) return;
  clearTimeout(timers.reply);
  if (!turn.responded) {
    turn.responded = true;
    if (listening && !holdMode) stopListening();
  }
  postUser();
}

function postUser() {
  if (!turn || turn.postedUser || !turn.inText.trim()) return;
  turn.postedUser = true;
  app.bus.emit('chat:post', { role: 'user', text: `🎙 ${turn.inText.trim()}` });
}

function finishTurn() {
  postUser();
  // A turn that only called tools isn't the end: Gemini speaks in the next turn, after our tool response.
  if (turn.toolRound && !turn.outText.trim()) {
    turn.toolRound = false;
    if (state !== 'speaking') setState('thinking');
    return;
  }
  if (turn.outText.trim()) app.bus.emit('chat:post', { role: 'ai', text: turn.outText.trim() });
  turn.outText = '';
  turn.done = true;
  if (!player?.sources.size) onPlaybackEnd();
}

async function handleTools(calls) {
  if (turn) { turn.toolRound = true; turn.done = false; }
  if (!listening && state !== 'speaking') setState('thinking');
  const tools = app.orchestrator.tools();
  const responses = await Promise.all(calls.map(async (fc) => {
    const args = fc.args || {};
    app.bus.emit('chat:post', { role: 'tool', text: `→ ${fc.name}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''}` });
    chip(describeTool(fc.name, args));
    const tool = tools.find((t) => t.name === fc.name);
    let result;
    try {
      const run = Promise.resolve(tool ? tool.handler(args, app) : { error: `unknown tool ${fc.name}` });
      result = await Promise.race([run, sleep(SLOW_TOOL_MS).then(() => ({ status: 'started', note: 'Still running; the result will appear in the Agent Hub.' }))]);
    } catch (e) {
      result = { error: e.message };
    }
    return { id: fc.id, name: fc.name, response: { result: result ?? { ok: true } } };
  }));
  send({ toolResponse: { functionResponses: responses } });
}

function describeTool(name, a) {
  const site = (id) => app.store.get().sites.find((s) => s.id === id)?.name.split(' · ')[1] || id;
  switch (name) {
    case 'select_site': return `Flying to ${site(a.site_id)}`;
    case 'fly_to': return 'Moving the camera';
    case 'set_view_mode': return `Switching to ${String(a.mode).toUpperCase()}`;
    case 'set_design_params': return `Updating design ${Object.entries(a).map(([k, v]) => `${k} ${v}`).join(' · ')}`;
    case 'run_agent': return `Running ${app.registry.agent(a.agent_id)?.name || a.agent_id}`;
    case 'set_stage': return `Opening ${a.stage}`;
    case 'toggle_layer': return `${a.visible ? 'Showing' : 'Hiding'} ${a.layer}`;
    case 'list_candidate_sites': return 'Reviewing candidate sites';
    case 'get_state': return 'Checking the proposal';
    default: return name.replace(/_/g, ' ');
  }
}

// ---------------------------------------------------------------- microphone
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ac = new AudioContext();
  await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const src = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, 'mic-tap');
  const ratio = ac.sampleRate / IN_RATE;
  let carry = [];
  let carryLen = 0;
  node.port.onmessage = (e) => {
    if (!listening) return;
    const f = e.data;
    // downsample to 16 kHz by averaging
    const outLen = Math.floor(f.length / ratio);
    const out = new Int16Array(outLen);
    let peak = 0;
    for (let i = 0; i < outLen; i++) {
      let sum = 0;
      const a = Math.floor(i * ratio);
      const b = Math.min(f.length, Math.floor((i + 1) * ratio));
      for (let j = a; j < b; j++) sum += f[j];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
      peak = Math.max(peak, Math.abs(v));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    level('mic', peak);
    carry.push(out);
    carryLen += outLen;
    if (carryLen >= IN_RATE / 10) { // ~100 ms chunks
      const chunk = new Int16Array(carryLen);
      let o = 0;
      carry.forEach((c) => { chunk.set(c, o); o += c.length; });
      carry = [];
      carryLen = 0;
      pushAudio(chunk);
    }
  };
  src.connect(node);
  node.connect(ac.destination); // pulls the graph; the worklet outputs silence
  mic = { stream, ac, src, node };
}

function stopMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ac.close().catch(() => {});
  mic = null;
  level('mic', 0);
}

function toB64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function pushAudio(chunk) {
  if (ws?.readyState !== 1 || state === 'connecting') {
    if (preBuffer.length < 150) preBuffer.push(chunk); // keep up to ~15 s while connecting
    return;
  }
  send({ realtimeInput: { audio: { data: toB64(chunk), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
}

// ---------------------------------------------------------------- playback
function ensurePlayer() {
  if (player) { player.ac.resume(); return; }
  const ac = new AudioContext(); // created inside a user gesture so autoplay policies allow it
  const gain = ac.createGain();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 512;
  gain.connect(analyser);
  analyser.connect(ac.destination);
  player = { ac, gain, analyser, next: 0, sources: new Set() };
}

function play(b64, rate) {
  if (!player) return;
  const bin = atob(b64);
  const n = bin.length >> 1;
  if (!n) return;
  const buf = player.ac.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    ch[i] = v / 0x8000;
  }
  player.gain.gain.value = settings.speak ? 1 : 0;
  const src = player.ac.createBufferSource();
  src.buffer = buf;
  src.connect(player.gain);
  const t = Math.max(player.ac.currentTime + 0.04, player.next);
  src.start(t);
  player.next = t + buf.duration;
  player.sources.add(src);
  src.onended = () => {
    player?.sources.delete(src);
    if (player && !player.sources.size) onPlaybackEnd();
  };
  if (state !== 'speaking' && !listening) setState('speaking');
  meter();
}

function stopPlayback() {
  if (!player) return;
  player.sources.forEach((s) => { s.onended = null; try { s.stop(); } catch { /* not started */ } });
  player.sources.clear();
  player.next = 0;
  level('voice', 0);
}

function onPlaybackEnd() {
  level('voice', 0);
  if (!turn?.done || listening) return;
  setState('idle');
  clearTimeout(timers.hide);
  timers.hide = setTimeout(hideCaptions, 4000);
}

function meter() {
  if (timers.meter) return;
  const data = new Uint8Array(player.analyser.fftSize);
  const tick = () => {
    if (!player?.sources.size) { timers.meter = null; level('voice', 0); return; }
    player.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    level('voice', peak);
    timers.meter = requestAnimationFrame(tick);
  };
  timers.meter = requestAnimationFrame(tick);
}

function level(source, v) {
  const l = Math.min(1, v * 1.8);
  if (ui.btn) ui.btn.style.setProperty('--level', l.toFixed(3));
  app?.bus.emit('audio:level', { level: l, source });
}

// ---------------------------------------------------------------- listening flow
async function startListening(hold = false) {
  if (listening) return;
  dismissHint();
  stopPlayback(); // tapping while it talks = interrupt
  ensurePlayer();
  clearTimeout(timers.hide);
  clearTimeout(timers.reply);
  listening = true;
  holdMode = hold;
  turn = freshTurn();
  preBuffer = [];
  setState(ws?.readyState === 1 ? 'listening' : 'connecting');
  caption('user', '');
  try {
    await startMic();
  } catch {
    listening = false;
    fail('Microphone blocked — allow mic access in the browser, or type instead');
    return;
  }
  if (!listening) { stopMic(); return; } // released before the mic opened
  try {
    await connect();
  } catch (e) {
    listening = false;
    stopMic();
    fail(`Voice unavailable (${e.message}) — type instead`);
    return;
  }
  if (state === 'connecting') setState('listening');
  preBuffer.forEach((c) => send({ realtimeInput: { audio: { data: toB64(c), mimeType: `audio/pcm;rate=${IN_RATE}` } } }));
  preBuffer = [];
  if (!listening) endAudio(); // released while connecting
  if (!hold) timers.tap = setTimeout(() => listening && stopListening(), MAX_TAP_MS);
}

function stopListening() {
  if (!listening) return;
  listening = false;
  clearTimeout(timers.tap);
  stopMic();
  if (ws?.readyState === 1 && state !== 'connecting') endAudio();
  if (state !== 'speaking') setState('thinking');
  if (turn?.responded) return;
  timers.reply = setTimeout(() => {
    if (turn?.responded) return;
    caption('ai', turn?.inText ? 'Sorry — no answer came back. Try again or type it.' : 'I didn’t catch that — try again.');
    setState('idle');
    timers.hide = setTimeout(hideCaptions, 3500);
  }, REPLY_TIMEOUT_MS);
}

function endAudio() {
  send({ realtimeInput: { audioStreamEnd: true } });
}

function fail(msg) {
  setState('error', msg);
  app.ui.toast(msg, { kind: 'warn', ms: 4500 });
  hideCaptions();
  setTimeout(() => state === 'error' && setState('idle'), 4000);
}

// ---------------------------------------------------------------- captions
function caption(kind, text) {
  clearTimeout(timers.hide);
  ui.captions.hidden = false;
  ui.captions.classList.add('is-on');
  if (kind === 'user') {
    ui.capUser.innerHTML = text ? `“${esc(text.trim())}”` : '<span class="captions__listening">Listening<i>.</i><i>.</i><i>.</i></span>';
    if (!turn?.outText) ui.capAi.textContent = '';
  } else {
    const t = text.trim();
    ui.capAi.textContent = t.length > 220 ? `…${t.slice(-220)}` : t;
  }
}

function chip(text) {
  ui.capChip.textContent = `→ ${text}`;
  ui.capChip.classList.remove('is-on');
  void ui.capChip.offsetWidth;
  ui.capChip.classList.add('is-on');
  ui.captions.hidden = false;
  ui.captions.classList.add('is-on');
}

function hideCaptions() {
  ui.captions?.classList.remove('is-on');
  timers.hideDone = setTimeout(() => {
    if (ui.captions?.classList.contains('is-on')) return;
    ui.captions.hidden = true;
    ui.capUser.textContent = '';
    ui.capAi.textContent = '';
    ui.capChip.textContent = '';
  }, 300);
}

// ---------------------------------------------------------------- first-run hint
const HINT_KEY = 'monolith.voiceHintSeen';

function showHintOnce() {
  let seen = false;
  try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { /* storage blocked: show it */ }
  if (seen) return;
  timers.hintIn = setTimeout(() => ui.hint?.classList.add('is-on'), 1500);   // after the loader fades
  timers.hintOut = setTimeout(dismissHint, 1500 + 6000);
}

function dismissHint() {
  clearTimeout(timers.hintIn);
  clearTimeout(timers.hintOut);
  if (!ui.hint) return;
  ui.hint.classList.remove('is-on');
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked */ }
}

// ---------------------------------------------------------------- agent
export default {
  id: 'voice',
  name: 'Voice Copilot',
  icon: '🎙',
  color: '#e8613c',
  stage: 'site',
  description: 'Talk to the map with Gemini Live.',
  hidden: true, // no hub card: lives in the command bar + captions
  cache: false,

  init(ctx) {
    app = ctx;
    const slot = ctx.ui.slots.command;
    slot.innerHTML = `
      <button type="button" class="mic-btn" data-state="idle" title="${TITLES.idle}">${MIC_SVG}</button>
      <button type="button" class="mic-menu-btn" title="Voice settings">${CHEVRON}</button>
      <div class="mic-hint">🎙 Tap to talk, or hold <kbd>Space</kbd></div>
      <div class="mic-menu card" hidden>
        <div class="mic-menu__title">Voice Copilot <span class="muted">· ${esc(CONFIG.MODELS.live)}</span></div>
        <label class="mic-menu__row">Voice
          <select class="input">${VOICES.map((v) => `<option ${v === settings.voice ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
        <label class="mic-menu__row mic-menu__check"><input type="checkbox" ${settings.speak ? 'checked' : ''}> Speak replies aloud</label>
        <div class="mic-menu__hint">Tap the mic and speak, or hold <kbd>Space</kbd> while talking.</div>
      </div>`;
    ui.btn = slot.querySelector('.mic-btn');
    ui.hint = slot.querySelector('.mic-hint');
    showHintOnce();
    const menuBtn = slot.querySelector('.mic-menu-btn');
    const menu = slot.querySelector('.mic-menu');
    menu.querySelector('select').onchange = (e) => { settings.voice = e.target.value; saveSettings(); closeSession(); };
    menu.querySelector('input[type=checkbox]').onchange = (e) => {
      settings.speak = e.target.checked;
      saveSettings();
      if (player) player.gain.gain.value = settings.speak ? 1 : 0;
    };
    menuBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) menu.hidden = true; });

    ui.btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (listening) stopListening();
      else startListening(false);
    });

    // captions over the map
    const cap = document.createElement('div');
    cap.className = 'captions';
    cap.hidden = true;
    cap.innerHTML = '<div class="captions__chip"></div><div class="captions__user"></div><div class="captions__ai"></div>';
    ctx.ui.slots.stage.appendChild(cap);
    ui.captions = cap;
    ui.capUser = cap.querySelector('.captions__user');
    ui.capAi = cap.querySelector('.captions__ai');
    ui.capChip = cap.querySelector('.captions__chip');

    // hold Space to talk (ignored while typing)
    const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || typing() || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (!e.repeat) startListening(true);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || typing()) return;
      e.preventDefault(); // stop a focused button from being "clicked" by Space
      if (holdMode) stopListening();
    }, true);
  },

  reset() {
    dismissHint();
    listening = false;
    Object.values(timers).forEach((t) => { clearTimeout(t); cancelAnimationFrame(t); });
    timers = {};
    stopMic();
    stopPlayback();
    closeSession(); // fresh conversation next time
    turn = null;
    hideCaptions();
    setState('idle');
  },
};

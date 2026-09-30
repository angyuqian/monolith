# Monolith: Data Centre Studio

Find a site in Singapore, design a hyperscale data centre on it, and hand the proposal to AI agents for compliance checks, renders and stakeholder comms.

It's static HTML/CSS/JS with no build step and no backend. It runs on MapLibre with OpenFreeMap tiles and 118k OSM buildings. The AI side is Gemini 3.8 Flash (orchestrator and agents), Nano Banana (`gemini-3.1-flash-image`) for concept renders, and Gemini Omni for flythrough videos.

## Run it

```bash
python3 -m http.server 8000     # any static server works
open http://localhost:8000
```

To deploy, upload the folder to any static host (Firebase Hosting, GitHub Pages, Cloud Storage).

**Demo flow.** Click **Site A**, then **Design on this site →**, then drag the sliders, press **T** for 2D/3D, go to **03 Review** and hit **Run all agents**. Or type in the top bar, e.g. *"find the best 60 MW site in the west, away from housing"*.

**Talk to it.** Tap the 🎙 mic in the command bar, or hold **Space**, and say e.g. *"take me to the Loyang site and show it in 2D"* or *"make it 80 megawatts and run the compliance check"*. Voice Copilot uses **Gemini Live** (`gemini-3.8-live`, native audio). It uses the same actions as the chat, so the map moves while it answers out loud. Live captions appear over the map, and everything is logged in the chat. The ▾ next to the mic chooses the voice and turns spoken replies on or off. The first use asks for microphone permission; use Chrome, and allow the mic.

**Email the investor memo.** In Comms, choose **Investor memo (email)** and press Draft, or say or type *"email the investor memo"*.
- Gemini drafts the subject line and memo from the project data.
- A compose window opens with the concept render, flythrough and compliance summary attached.
- **You** press Send. Sending is simulated, with Undo, and nothing leaves the app. **Open in Gmail ↗** hands the draft to a real Gmail compose tab instead.
- The recipient is set in `config.local.js` under `COMMS.recipient`, so real addresses never reach the repo.
- Cached drafts use `{{first_name}}` / `{{org}}` placeholders, filled in at display time.

**Reset between runs.** Press **↺ Reset** in the top bar (or `Shift+R`). It clears the site, design, agent results and chat, and flies back to the island view, with no reload. Cached renders are kept.

**Shortcuts:**

| Key | Action |
| --- | --- |
| `T` | 2D/3D |
| `O` | orbit |
| `L` | layers |
| `C` | agent constellation |
| `1` `2` `3` | stages |
| `⌘K` | command bar |
| `Shift+R` | reset demo |
| hold `Space` | talk to Voice Copilot |

## Render and agent cache

Omni flythroughs take about 75 s and Nano Banana renders about 20 s. For the rehearsed demo path they're pre-generated and served from a cache.

**Lookup order:** every agent run checks, in order:

1. **Project cache** (`data/cache/`): committed, so it works on any machine and offline.
2. **Browser cache** (IndexedDB): anything generated live on this machine.
3. **Live Gemini call.** The result is then saved to the browser cache.

**What counts as a match:** agent + variant (such as `image:dusk` or `comms:community`) + site + the exact design parameters. If you move a slider, it's a fresh live generation. To reuse per-site results even after changing the design, set `CONFIG.CACHE.matchSite = true`.

**Background pre-rendering:** when a site is picked, or the design stops changing for 4 s, Render Studio quietly starts the concept image and the Omni flythrough. Clicking Render (or asking by voice or chat) picks up that job instead of starting a new one, so after a minute of talking about a design, its renders are usually ready.
- At most one image and one video are generated at a time; if the design keeps changing, only the latest request waits.
- It only runs in 3D view.
- Turn it off with `CONFIG.CACHE.prefetch.enabled = false`, or set `video: false` to pre-render images only.

**How it looks:** cached results appear after a short "working" beat (`CACHE.simulatedDelayMs`) and carry a small `· cached` tag in the agent card.

**Regenerating the project cache.** This needs Node, uses your installed Chrome, and takes about 2 min per site with video:

```bash
npm install                 # once (puppeteer-core only)
npm run prewarm             # sites/styles/comms from CONFIG.CACHE.prewarm
npm run prewarm -- --sites site-2,site-4 --styles day,dusk --no-video
```

New runs merge into `data/cache/manifest.json`. Commit `data/cache/` to share it with the team. To clear the browser cache, run `monolith.cache.clearBrowser()` in devtools. To turn caching off, set `CONFIG.CACHE.enabled = false`.

**Make your agent cacheable:** agents are cached by default. Set `cacheVariant` if one agent produces different outputs (see `agents/render.js`), `cacheScope: 'global'` if the result doesn't depend on the site, or `cache: false` to opt out.

## Add your agent (5 minutes)

1. `cp agents/_template.js agents/myAgent.js`
2. Add `'myAgent.js'` to `agents/index.js`.
3. Reload. Your agent gets a card in the Agent Hub, a node in the constellation, a spot in **Run all agents**, and a `run_agent` entry the orchestrator can call from chat.

```js
export default {
  id: 'myAgent', name: 'My Agent', icon: '◆', color: '#5b7fc7', stage: 'review',
  description: 'One line for the hub.',
  async run(ctx) {
    const { metrics } = ctx.getDesign();
    const { text } = await ctx.gemini.generate(`Assess this design: ${JSON.stringify(metrics)}`);
    return { status: 'info', summary: text.slice(0, 200) };   // 'pass' | 'warn' | 'fail' | 'info'
  },
  renderResult(el, result) { /* optional rich card body */ },
  fallback() { return { status: 'info', summary: 'Offline demo output' }; }, // shown if Gemini fails
  tools: [ /* optional extra Gemini function-calling tools, JSON Schema params */ ],
};
```

Agents load in isolation, so a broken agent file never takes the app down. Agents don't import each other. Instead they read shared state (`ctx.store.get().agents.compliance.result`) and emit events (`ctx.bus`).

### What `ctx` gives you

| | |
|---|---|
| `ctx.getSite()` / `ctx.getDesign()` | selected site (score, breakdown, nearest substation/DC) and design `{ params, metrics, warnings, geojson }` |
| `ctx.snapshot()` / `ctx.map.cleanSnapshot()` | JPEG of the 3D view (clean = labels hidden), ready for image models |
| `ctx.gemini` | `generate`, `generateJSON(prompt, schema)`, `image(prompt, {images})`, `omni(prompt, {images})`, `video()` |
| `ctx.actions` | `selectSite`, `setDesignParams`, `setStage`, `setMode`, `toggleLayer`, `flyTo`, `runAgent(id, opts)`, `runTask(id, fn, fallback, { variant })`, `reset` |
| `ctx.cache` | `get`/`put` results, `clearBrowser()`, `stats()` |
| `ctx.massing(site, params)` | pure massing + metrics engine (`js/design/massing.js`) |
| `ctx.map.map` | raw MapLibre instance for custom layers |
| `ctx.ui` | `toast`, `lightbox(src, 'image' \| 'video')`, `ask(text)` (send a message to the orchestrator) |

In devtools, everything is exposed on `window.monolith`, e.g. `monolith.actions.runAgent('compliance')`.

## Who owns what

| Area | File | Notes |
|---|---|---|
| Omni flythroughs | `agents/render.js` → `flythrough()` | Omni runs through the **Interactions API** and returns an inline mp4 (~10 s long, ~75 s to generate). Snapshots are centre-cropped to 16:9 so the output is landscape. |
| Compliance | `agents/compliance.js` | Deterministic checks + Gemini explanation. Plug real URA/NEA rule sources into `localChecks()`. |
| Voice | `agents/voice.js` | Live API WebSocket from the browser; reuses `ctx.orchestrator.tools()`. Replies ~0.4 s after you stop talking. |
| Comms | `agents/comms.js` | Brief / letter / press / investor drafts. Add channels (Gmail, Docs, Slack), translation, TTS. |
| Site selection | `agents/siteScout.js`, `scripts/prep_data.py` | Scoring weights live in `prep_data.py` (land 35%, power 25%, fibre 20%, community 20%). |

## Project layout

```
index.html, config.js         keys + model ids (DEMO_FALLBACK keeps the demo alive if Gemini fails)
css/                          tokens.css (palette from design refs), app.css
js/main.js                    boot sequence + click router
js/core/                      store, bus, registry, gemini client, actions, orchestrator
js/map/                       MapAdapter (renderer-agnostic), maplibre.js, google3d.js, layers/*
js/design/massing.js          parametric DC massing + engineering metrics
js/ui/                        shell, left panel (stages), agent hub (chat), constellation overlay, map controls
agents/                       one file per agent + index.js manifest
data/build/                   generated, browser-sized data (≈10 MB)
data/cache/                   pre-generated agent results + media (npm run prewarm)
scripts/prep_data.py          regenerates data/build from data/sg_buildings_v5.geojson (stdlib only)
scripts/prewarm.mjs           drives the app headlessly to fill data/cache
```

Regenerate the data after changing scoring with `python3 scripts/prep_data.py`, which takes about 1 minute.

## Keys and limits

- **Gemini key (not committed).** GitHub push protection blocks keys, and Google disables leaked ones. Provide it in any of these ways:
  - **Locally:** `cp config.local.example.js config.local.js` and paste the key. The file is gitignored.
  - **On a deployed site:** open it once with `?key=YOUR_KEY` in the URL, or click the **Gemini** pill in the top bar. The key is remembered in that browser only.
  - **Without a key:** the cached demo path (`data/cache/`) still works, and everything else shows canned demo output.
- **Google Maps needs a separate key.** Maps JS, Places, Geocoding and Photorealistic 3D Tiles need a Maps key starting `AIza…`. Put it in `GOOGLE_MAPS_KEY` in `config.local.js` and a **Photoreal** (globe) button appears in the map controls. That path (`js/map/google3d.js`) hasn't been tested yet because we don't have a Maps key.
- **Veo is unverified.** `gemini.video()` (Veo long-running op) is wired up but untested. Omni is the verified video path.
- **Basemap warning.** The console shows `Expected value to be of type number, but found null` from the OpenFreeMap basemap style. It's harmless.

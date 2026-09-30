# Monolith: Data Centre Studio

**Live demo:** https://angyuqian.github.io/monolith/ opens with a short **Help** guide and works without any setup. See [what's pre-loaded](#whats-pre-loaded-where).

Monolith finds a site in Singapore for a hyperscale data centre, designs the building on it, and hands the proposal to a team of AI agents. The agents check compliance, render photoreal images and flythrough videos, and draft stakeholder and investor communications. You drive it by clicking, typing, or talking.

- **No build step, no backend.** It's static HTML/CSS/JS that runs in the browser.
- **Map:** MapLibre GL with OpenFreeMap tiles, plus 118,782 Singapore buildings from OpenStreetMap.
- **AI:** Google Gemini, called directly from the browser:

| Job | Model |
|---|---|
| Chat orchestrator and agents | `gemini-3.8-flash`, with automatic fallback to 3.7 / 3.6 / 3.5 / 3-preview / 3.5-lite when busy |
| Concept renders ("Nano Banana") | `gemini-3.1-flash-image` |
| Flythrough videos, via the Interactions API | `gemini-omni-1.1-flash` |
| Voice, via the Live API | `gemini-3.8-live` |

---

## Contents

1. [Quick start](#quick-start)
2. [Feature tour](#feature-tour)
3. [Suggested 3-minute demo](#suggested-3-minute-demo)
4. [Controls](#controls)
5. [Architecture](#architecture)
6. [Agents](#agents)
7. [Add your own agent](#add-your-own-agent)
8. [Data and scoring](#data-and-scoring)
9. [Design model and assumptions](#design-model-and-assumptions)
10. [Speed: caching and pre-rendering](#speed-caching-and-pre-rendering)
11. [Configuration](#configuration)
12. [Deploying](#deploying)
13. [Troubleshooting](#troubleshooting)
14. [Known limitations](#known-limitations)
15. [Project layout](#project-layout)

---

## Quick start

```bash
git clone https://github.com/angyuqian/monolith.git && cd monolith
cp config.local.example.js config.local.js   # paste a Gemini API key into GEMINI_KEY
npm start                                    # = python3 -m http.server 8000 (any static server works)
```

Open **http://localhost:8000 in Chrome**. Chrome is recommended for voice and video. The first load takes about 7 s while it loads the city model.

- **Gemini key:** get one at https://aistudio.google.com/apikey. **Never commit it**: GitHub reports public keys to Google, which disables them within minutes. `config.local.js` is gitignored.
- **Images and video need billing.** On Google's free tier, text and voice work, but Nano Banana renders and Omni flythroughs have a quota of 0. Enable billing on the key's Google Cloud project for renders.
- **If Gemini is unreachable or busy,** the app still runs. Text requests fall back to other Gemini models automatically, and anything that still fails shows canned demo output with an explanatory message.
- **`npm install`** is only needed if you want to pre-generate renders (see [caching](#speed-caching-and-pre-rendering)).

---

## Feature tour

The workflow has three stages: **01 Site → 02 Design → 03 Review**. Switch between them with the top bar or the keys `1` `2` `3`.

### 01 Site: find a site
- **Suitability grid:** orange 250 m cells scored 0–100 across the island. Darker means a better fit.
- **Eight candidate sites (A–H):** the top-scoring locations at least 1.5 km apart, each with a score breakdown covering industrial land, grid power, fibre / DC cluster and community buffer.
- **Choose a site** by clicking a lettered pin, clicking any grid cell, picking from the list, or asking Monolith.
- **Infrastructure layers:** existing data centres (coral) and grid substations (purple). Open the **Layers** panel with `L`.
- **✦ Rank with AI:** Site Scout ranks and explains the candidates.

### 02 Design: parametric massing
- Selecting a site generates a data-centre campus on it: data halls, an office, a substation, a generator yard, rooftop cooling, and a dimensioned parcel.
- **Sliders** control IT load (MW), halls, storeys, cooling (liquid or air), redundancy (N+1 or 2N), and parcel size and rotation. The massing and the metrics update live.
- **Metrics:** IT capacity, design PUE, white space, racks, GFA, height, plot ratio, gensets, energy, water, carbon and capex, plus warnings when the programme doesn't fit.
- Existing buildings on the parcel are flattened.
- **2D/3D:** press `T` to switch to a flat land-use plan. `O` starts a cinematic orbit.

### 03 Review: the agent team
- **▶ Run all agents** runs every agent at once. The **constellation** view shows agent cards floating over the map, linked to the site (toggle with `C`).
- Each agent also has its own card in the **Agent Hub** (right panel), with a run button and rich results.

### Chat and command bar (the orchestrator)
Type in the top bar or the chat, e.g. *"find the best 60 MW site in the west, away from housing"*, *"make it 80 MW with air cooling"* or *"run compliance and draft a community letter"*.

Gemini acts on the app through tools: list sites, select a site, fly the camera, change the design, switch 2D/3D, toggle layers and run agents. The small purple lines in the chat show each action it takes. The chat is always live, never cached.

### Voice Copilot
- **Tap** the coral 🎙 in the command bar, or **hold Space**, and speak, e.g. *"take me to Site D and show it in 2D"*.
- **Gemini Live** answers out loud (about 0.4 s after you stop), moves the map with the same tools as the chat, and shows **live captions** over the map.
- Everything is logged in the chat.
- The **▾** next to the mic chooses the voice and turns spoken replies on or off.
- **Tip:** say site letters ("Site D") rather than street names. Speech recognition handles letters more reliably.

### Investor memo email
- In the **Comms** card, choose **Investor memo (email)** → **Draft**, or say or type *"email the investor memo"*.
- An email-style compose window opens with the memo and the concept render, flythrough and compliance summary attached.
- **You press Send.** Sending is **simulated**, with a Gmail-like Undo, and nothing leaves the app.
- **Open in Gmail ↗** opens a real Gmail draft instead, for you to send yourself.
- The recipient comes from `config.local.js` (`COMMS.recipient`), so real addresses never reach the repo.

### Multiplayer mode (mock)
- Click the **avatar row** in the top bar, or press **M**, to show Figma/Miro-style live cursors.
- **Agent cursors** appear while agents actually run:
  - Site Scout visits the top sites by score.
  - Compliance traces the parcel and drops result pins.
  - Render frames the massing.
  - Comms highlights and co-types in the memo.
- **Teammate cursors** (Andrew and Sammie) follow a scripted storyline: they point at Site D's grid connection, the compliance warning, the site's weakest criterion, and more.
- It's **visual only** and never changes the design. Rename the teammates in `HUMANS` in `agents/presence.js`.

### Reset
**↺ Reset** in the top bar (or `Shift+R`) returns to a fresh session without reloading. It clears the site, design, agent results and chat, and multiplayer turns off. Cached renders are kept.

---

## Suggested 3-minute demo

1. **Island view:** *"118k buildings, scored for data-centre suitability."* Press `T` to show the 2D land-use plan, then `T` again.
2. **Voice:** hold Space: *"Take me to Site D."* The map flies to Pasir Panjang, with captions.
3. **Site story:** 759 m to Labrador 400kV Substation, industrial land 100, community buffer 99. Fibre (44) is the trade-off.
4. **Design:** open 02, drag IT load and storeys, and watch the massing and PUE change live.
5. **Multiplayer:** press `M` as the reveal: *"and here's the team working live."*
6. **Review:** **Run all agents**. Cursors and constellation cards light up, compliance pins drop, and the render appears.
7. **Flythrough:** Render Studio → **▶ Omni flythrough** (instant, from the cache).
8. **Close:** *"Email the investor memo."* Review the draft and press **Send**.
9. Press **Reset** before the next run.

> Site Scout ranks Site A first (score 95 vs D's 82). If you pitch D, either skip Site Scout or frame it: *"A wins on fibre; D wins on the 400kV grid and the waterfront."*

---

## Controls

| Key | Action |
|---|---|
| `1` `2` `3` | Site / Design / Review |
| `T` | 2D / 3D |
| `O` | orbit camera |
| `L` | layers panel |
| `C` | agent constellation |
| `M` | multiplayer cursors |
| hold `Space` | talk to Voice Copilot |
| `⌘K` | focus the command bar |
| `Shift+R` | reset demo |
| `Esc` | close popovers |
| `?` button | help guide |

---

## Architecture

```
                 ┌──────────── index.html + css/ ────────────┐
                 │  top bar · left panel · map · agent hub    │
                 └───────────────────┬────────────────────────┘
js/main.js  boot: map → data layers → cache → agents → UI → click router
                                     │
     ┌───────────────┬───────────────┼────────────────┬──────────────────┐
 js/map/          js/core/        js/core/          js/core/          agents/*.js
 MapAdapter       store + bus     actions           orchestrator      one file each,
 (MapLibre;       (state +        (the only place   (Gemini function  loaded in
 Google 3D        events)         that mutates      calling over      isolation
 optional)                        state + map)      core + agent      from agents/
     │                                 │            tools)            index.js
 layers/:                          js/core/cache.js      │
 buildings, suitability,           (project files →      └── voice.js reuses the
 datacentres, design               IndexedDB → live)          same tools over the
                                                               Live API
```

**Principles:**
- **One place changes things:** UI, chat, voice and agents all go through `ctx.actions`, so every way of asking behaves the same.
- **Agents never import each other.** They share state through `ctx.store` and events through `ctx.bus`.
- **A broken agent file can't crash the app:** each one loads, mounts and runs inside `try/catch`.
- **Demo-safe:** every Gemini call has a timeout, plus an optional canned fallback (`CONFIG.DEMO_FALLBACK`).

---

## Agents

| Agent | File | What it does | Model |
|---|---|---|---|
| **Site Scout** | `agents/siteScout.js` | Ranks the candidates and explains the trade-offs | text |
| **Render Studio** | `agents/render.js` | Photoreal concept render from the live 3D view; Omni flythrough video; background pre-rendering | image, Omni |
| **Compliance** | `agents/compliance.js` | Deterministic checks on the design (PUE, plot ratio, height, grid, housing buffer, water) extended and explained by Gemini | text |
| **Comms** | `agents/comms.js` | Stakeholder brief, community letter, press release, investor memo email (compose window: `agents/lib/compose.js`) | text |
| **Voice Copilot** | `agents/voice.js` | Talk to the map (no hub card) | Live |
| **Multiplayer** | `agents/presence.js` | Mock collaborator cursors (no hub card) | none |

---

## Add your own agent

1. `cp agents/_template.js agents/myAgent.js`
2. Add `'myAgent.js'` to `agents/index.js`.
3. Reload.

Your agent gets a card in the Agent Hub, a node in the constellation, a place in **Run all agents**, and a `run_agent` entry the chat and voice can call.

```js
export default {
  id: 'myAgent', name: 'My Agent', icon: '◆', color: '#5b7fc7', stage: 'review',
  description: 'One line for the hub.',
  async run(ctx, opts) {
    const { metrics } = ctx.getDesign();
    const { text } = await ctx.gemini.generate(`Assess this design: ${JSON.stringify(metrics)}`);
    return { status: 'info', summary: text.slice(0, 200) };   // status: 'pass' | 'warn' | 'fail' | 'info'
  },
  renderResult(el, result, ctx) {},   // optional: rich card body
  fallback(ctx) { return { status: 'info', summary: 'Offline demo output' }; },  // optional: used if Gemini fails
  tools: [],                          // optional: extra Gemini function-calling tools (JSON Schema params)
};
```

**Optional hooks:**

| Hook | Purpose |
|---|---|
| `mount(el, ctx)` | custom controls inside the agent's card |
| `init(ctx)` | UI outside the card; slots are `ctx.ui.slots.command`, `.stage` and `.topbar` |
| `hidden: true` | no hub card or constellation node (used by voice and multiplayer) |
| `reset(ctx)` | clear module state when the presenter hits Reset |
| `cacheVariant(ctx, opts)` / `cacheScope: 'global'` / `cache: false` | control caching |
| `manualOnly: true` | skipped by "Run all agents" |

**What `ctx` gives you:**

| | |
|---|---|
| `ctx.getSite()` / `ctx.getDesign()` | the selected site (score, breakdown, nearest substation and DC) and the design `{ params, metrics, warnings, geojson }` |
| `ctx.gemini` | `generate`, `generateJSON(prompt, schema)`, `image(prompt, { images })`, `omni(prompt, { images })`, `video()` |
| `ctx.actions` | `selectSite`, `setDesignParams`, `setStage`, `setMode`, `toggleLayer`, `flyTo`, `runAgent(id, opts)`, `runTask(id, fn, fallback, opts)`, `reset` |
| `ctx.snapshot()` / `ctx.map.cleanSnapshot()` | JPEG of the 3D view (the clean version hides labels and overlays), ready for image models |
| `ctx.orchestrator` | `tools()`, `system`, `state()`, so another front-end can drive the same actions |
| `ctx.cache` | `get`, `peek`, `put`, `clearBrowser()`, `stats()` |
| `ctx.massing(site, params)` | the pure massing and metrics engine |
| `ctx.map.map` | the raw MapLibre instance, for custom layers |
| `ctx.ui` | `toast`, `lightbox(src, type)`, `ask(text)` (send a message to the chat) |

In devtools, everything is on `window.monolith`, e.g. `monolith.actions.runAgent('compliance')`.

---

## Data and scoring

`scripts/prep_data.py` (Python standard library only, about 1 min) turns the raw 135 MB OpenStreetMap export (`data/sg_buildings_v5.geojson`, not in the repo) into about 10 MB of browser-sized files in `data/build/`:

| File | Contents |
|---|---|
| `buildings.core.json` / `buildings.landed.json` | building footprints in a compact delta-encoded format (decoded by `js/map/layers/buildings.js`). Landed houses load after first paint. |
| `suitability.geojson` | 250 m score grid (cells scoring 40 or more) |
| `sites.json` | top 8 candidate sites, at least 1.5 km apart |
| `datacentres.geojson`, `substations.geojson` | infrastructure points |

**Score** = 35% industrial land + 25% grid power + 20% fibre + 20% community:

| Criterion | How it's measured |
|---|---|
| Industrial land | industrial / business-park share of the cell's building footprint |
| Grid power | 1 − distance to nearest substation ÷ 3 km |
| Fibre | 1 − distance to nearest data centre ÷ 5 km |
| Community | 1 − residential share in the surrounding 750 m block |

To change the weights, edit `prep_data.py` and re-run `npm run data`.

---

## Design model and assumptions

`js/design/massing.js` is pure JavaScript (no DOM) that turns parameters into geometry and metrics.

| Parameter | Liquid cooling | Air cooling |
|---|---|---|
| White-space power density | 4.0 kW/m² | 1.6 kW/m² |
| Rack density | 45 kW | 12 kW |
| Design PUE (+0.03 for 2N) | 1.18 | 1.38 |
| Water usage effectiveness | 0.2 L/kWh | 1.6 L/kWh |
| Capex | US$12.5M / MW | US$10.5M / MW |

**Other assumptions:**
- **Space and layout:** gross floor is 1.55 × white space. Floors are 6 m apart, plus 3.5 m of rooftop plant. There's a 12 m setback and a 30 m service yard.
- **Operation:** 80% average utilisation, and a grid carbon factor of 0.4168 kg CO₂/kWh (EMA 2023).
- **Generators:** 2.5 MW gensets. N+1 means *n + ⌈n/6⌉* units; 2N means *2n*.

Compliance thresholds are in `agents/compliance.js`:

| Check | Rule |
|---|---|
| PUE | ≤ 1.3 (DC-CFA) |
| Plot ratio | ≤ 2.5 (B2) |
| Height | ≤ 50 m |
| Substation distance | pass ≤ 2 km, warn ≤ 4 km |
| Community buffer | ≥ 70 |
| WUE | ≤ 1.0 |

These are **indicative figures for a demo**, not engineering advice.

---

## What's pre-loaded where

| | GitHub Pages / fresh clone | Presenter's laptop (after `npm run prewarm`) |
|---|---|---|
| City model, suitability grid, 8 sites, infrastructure (`data/build/`) | ✅ bundled | ✅ bundled |
| Basemap tiles | streamed from OpenFreeMap | streamed from OpenFreeMap |
| Concept renders | ⏳ live, ~15 s (starts in the background when you pick a site). **Needs billing** on the key's project; otherwise the live massing snapshot is shown | ✅ sites A–H at the default design, dusk |
| Omni flythroughs | ⏳ live, ~50 s. **Needs billing** on the key's project | ✅ sites A–H, any design (nearest site's video for custom cells) |
| Compliance, stakeholder brief, community letter, investor memo | ⏳ live, ~6–11 s each | ✅ sites A, D, F, G |
| Site Scout ranking | ⏳ live, ~7 s | ✅ |
| Chat and voice | always live | always live |
| Investor email recipient | generic "Investor" | from `config.local.js` |

Anything generated live is saved in that browser (IndexedDB), so repeating the same site and design is instant afterwards, on any machine.

## Speed: caching and pre-rendering

Live generation takes about **15 s** for a render and about **50 s** for an Omni flythrough. The app hides that wait in three ways.

**1. Result cache.** Every agent run checks, in order:

1. **Project cache** (`data/cache/`): pre-generated with `npm run prewarm`. **It's local only and gitignored**, so each presenter builds their own.
2. **Browser cache** (IndexedDB): everything generated live on this machine.
3. **Live Gemini call.** The result is then saved to the browser cache.

A match means the same agent + variant (e.g. `image:dusk`, `comms:investor`) + site + **exact design parameters**. **Flythroughs are the exception:** they always use the site's cached video, or the nearest candidate site's video for a custom cell, **regardless of design changes**. Cached results appear after a short "working" beat and show a small `· cached` tag.

**2. Background pre-rendering.** When a site is picked, or the design stops changing for 4 s, Render Studio quietly starts the image (and the video, if none is cached). A later click picks up the job in progress instead of starting a new one. At most one image and one video run at a time. Turn it off with `CONFIG.CACHE.prefetch.enabled = false`.

**3. Pre-generating** (needs Node and Chrome; about 2 min per site with video):

```bash
npm install                                             # once: puppeteer-core only
npm run prewarm                                         # sites / styles / comms from CONFIG.CACHE.prewarm
npm run prewarm -- --sites site-4 --only compliance,comms --comms brief,community,investor
npm run prewarm -- --sites site-2,site-5 --styles day,dusk --no-video
```

`--only` takes any of `scout, compliance, comms, image, video`. Runs merge into `data/cache/manifest.json`.

To clear the browser cache, run `monolith.cache.clearBrowser()` in devtools. To turn all caching off, set `CONFIG.CACHE.enabled = false`.

> Without a local `data/cache/`, as in a fresh clone, everything simply generates live on first use.

---

## Configuration

**`config.js`** (committed):
- **`MODELS`:** the model ids.
- **`DEMO_FALLBACK`:** show canned output when Gemini fails.
- **`CACHE`:** `enabled`, `matchSite`, `simulatedDelayMs`, `prefetch`, and the `prewarm` plan.
- **`MAP`:** style and starting camera.

**`config.local.js`** (gitignored; copy from `config.local.example.js`; it overrides the built-in hackathon key):

```js
export default {
  GEMINI_KEY: '',          // AI Studio key
  GOOGLE_MAPS_KEY: '',     // optional "AIza…" key: enables the Photoreal 3D button
  COMMS: {
    recipient: { name: 'Jane Doe', org: 'Example Capital', email: 'jane@example.com' },
    sender: 'The Monolith team',
  },
};
```

**Where the Gemini key comes from** (first match wins):
1. `?key=…` in the URL (remembered in that browser)
2. a key entered via the **Gemini** pill (remembered in that browser)
3. `config.local.js`. On GitHub Pages this file is generated at deploy time from the `GEMINI_KEY` repository secret.

`MODELS.textFallbacks` in `config.js` lists the models tried, in order, when the main text model is busy (503), out of quota (429), or times out. A failing model is skipped for 5 minutes.

---

## Deploying

**GitHub Pages** (already set up): `.github/workflows/pages.yml` redeploys https://angyuqian.github.io/monolith/ on every push to `main`, in about a minute.
- **Key:** the workflow writes `config.local.js` into the deployed copy from the **`GEMINI_KEY` repository secret**, so visitors need no setup and the key never enters the repo.
  - To change the key: `gh secret set GEMINI_KEY -R angyuqian/monolith`, then re-run the workflow (Actions tab → *Deploy to GitHub Pages* → *Run workflow*).
  - It's still readable in the browser, as every client-side key is. Consider restricting it to the Pages and localhost addresses in Google Cloud Console → Credentials.
- **Cache:** the local render cache doesn't exist on Pages, so it's skipped there.
- **Microphone:** works because Pages uses HTTPS.
- **Help:** a first-time visitor sees the Help guide; it's always available from **?** in the top bar.

**Any other static host** (Firebase Hosting, Cloud Storage, Netlify) works the same way: upload the folder.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| New features don't show up | Hard refresh with **Cmd+Shift+R**. Browsers cache the JavaScript modules. |
| Top bar says **Add Gemini key** / **Gemini offline** | Add the key to `config.local.js`, or click the pill. Check the key is valid for the Gemini API. |
| Mic does nothing, or turns amber | Allow microphone access for the site and use Chrome. Typing always works. |
| Renders are slow | They're live: the design differs from the pre-rendered version, or there's no local cache. Background pre-rendering starts about 4 s after the design settles. |
| Console: `Expected value to be of type number, but found null` | Harmless. It comes from the OpenFreeMap basemap style. |
| Console: 404 for `data/cache/manifest.json` or `config.local.js` (locally) | Harmless. There's no local cache or local config yet, so it uses defaults and generates live. |
| Toast: *"this Gemini key's plan has no quota for it (enable billing)"* | Renders and flythroughs need billing on the key's Google Cloud project (free tier = 0). Text and voice still work. |
| Console: *"gemini-3.8-flash unavailable (503); trying the next model"* | Google's model is busy. The app switched to a fallback model automatically; nothing to do. |
| AI suddenly shows canned output everywhere | The key may have been disabled or revoked. Create a new one, update `config.local.js` and the `GEMINI_KEY` secret, or use `?key=` / the Gemini pill. |

---

## Known limitations

- **Google Maps needs a separate key.** Maps JS, Places, Geocoding and Photorealistic 3D Tiles need an `AIza…` Maps key, not the Gemini key. The Photoreal view (`js/map/google3d.js`) hasn't been tested yet.
- **Veo is unverified.** `gemini.video()` is wired up but untested; Omni is the verified video path.
- **Omni videos are about 10 s long,** and are generated from a 16:9 snapshot of the current view.
- **Sending email is simulated.** Real sending would need a Google OAuth client for the Gmail API.
- **Multiplayer is a scripted mock,** with no real-time sync.
- **All figures are indicative.** Site scores, costs and compliance results come from open data and simplified rules.

---

## Project layout

```
index.html                 app shell
config.js                  models, cache, map settings (+ config.local.js for secrets, gitignored)
css/                       tokens.css (palette), app.css
js/main.js                 boot sequence + map click router
js/core/                   store, bus, registry, gemini client, actions, orchestrator, cache
js/map/                    MapAdapter, maplibre.js, google3d.js, layers/{buildings,suitability,datacentres,design}.js
js/design/massing.js       parametric massing + engineering metrics
js/ui/                     shell, left panel, agent hub + chat, constellation overlay, map controls, toast
agents/                    one file per agent, index.js manifest, _template.js, lib/compose.js
data/build/                browser-ready data (committed)
data/cache/                pre-generated agent results (local only, gitignored)
scripts/prep_data.py       rebuilds data/build from the raw OSM export
scripts/prewarm.mjs        fills data/cache by driving the app headlessly
```

Data © OpenStreetMap contributors. Tiles by OpenFreeMap. Rendering by MapLibre GL.

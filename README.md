# ⬢ OpenForge — Prompt to Print

Turn a **sentence or an image** into a **3D-printable model** and print it on a **Bambu Lab P1S**.

Under the hood: an LLM writes **OpenSCAD** (the open-source parametric CAD language), OpenForge compiles it with a real OpenSCAD binary — automatically repairing compile errors by feeding them back to the model — previews the mesh in your browser on a simulated 256 mm P1S plate, and exports the STL you drop into Bambu Studio.

```
 text / image ──▶ LLM (local or subscription) ──▶ OpenSCAD source
                       ▲      │
                       │      ▼
                 repair loop ◀── OpenSCAD compiler
                       │
                       ▼
        STL + stats + preview ──▶ Bambu Studio ──▶ P1S
```

## Quick start

**Requirements:** Node.js 20+ and [pnpm](https://pnpm.io). Optional: [OpenSCAD](https://openscad.org/downloads.html) (any recent build) and [Bambu Studio](https://bambulab.com/en/download/studio) for one-click P1S slicing.

```powershell
pnpm install
pnpm dev        # → http://localhost:3000
```

No OpenSCAD? The app tells you and links the installer; you can also set any path in **Settings**, or drop a portable copy into `tools/OpenSCAD/` (gitignored — stays local).

> First launch runs in **Demo** mode — the full pipeline works instantly with built-in templates (phone stand, gear, vase, calibration cube), no AI needed. Great for verifying your P1S export path before wiring up models.

Everything personal lives in `.data/` (settings, auth tokens, generated models) and is **gitignored** — the repo itself ships no configuration. The P1S profiles in `resources/bambu/` are checked in so slicing works out of the box; rebuild them anytime with `node scripts/build-bambu-profiles.mjs` (needs a local Bambu Studio install to read presets from).

## Providers (pick in the left panel)

| Provider | Setup | Notes |
|---|---|---|
| **Demo** | none | Built-in sample templates. |
| **Ollama (local)** | [Install Ollama](https://ollama.com), then `ollama pull qwen2.5-coder:7b` | Models auto-list. Any model works; vision models (`qwen2.5vl`, `llama3.2-vision`, …) enable image input. |
| **OpenAI-compatible** | Point at any `/v1` endpoint (LM Studio, vLLM, llama.cpp server…) | Optional API key, stored only in `.data/settings.json`. |
| **Codex (ChatGPT subscription)** | The Codex CLI ships with the app — click **Sign in with ChatGPT** in Settings: a one-time code appears and the device page opens; enter it and approve | Uses your ChatGPT plan via OAuth. **No API key.** Model selector offers the Codex models or your CLI default. |

All providers appear in the **model selector** with a status dot (green = reachable/signed-in); use the ✎ button to type any custom model id.

## Text & image input

- Type a description (`"hexagonal desk organizer, three compartments, 120 mm wide"`) — examples chips included.
- **Attach, drag-drop, or paste** (Ctrl+V) an image — screenshots of parts, sketches, references. Vision-capable models turn them into printable geometry.
- After a generation, the box becomes a **Refine** prompt: *"make the walls 2 mm thicker"* edits the current model instead of starting over.

## Reading the result

- **Viewport** — orbit/zoom (mouse), turntable, wireframe, CAD edges, build-plate toggle, camera reset, PNG screenshot. The grid is a real 256 mm P1S plate — what you see is what fits.
- **Build log** — every pipeline step streams live: model output progress, compile attempts, OpenSCAD errors, repair retries, mesh stats.
- **Model panel** — dimensions, triangle count, solid volume, **estimated material grams** at your chosen infill/material, a green/red **fits-the-P1S-plate** check (with suggested scale %), and the model's own supports recommendation (parsed from its metadata header).
- **History** — every forge is saved with a rendered thumbnail; click to reload, ✕ to delete. Stored under `.data/generations/`.

## Printing on the P1S

### One-click: Slice for P1S (needs Bambu Studio installed)

If **Bambu Studio** is installed on this PC, the model panel shows a **Slice for P1S** section. It runs the Bambu Studio CLI headlessly with bundled P1S profiles (`resources/bambu/` — machine *Bambu Lab P1S 0.4 nozzle*, process *0.20 mm Standard*, filament *Bambu PLA Basic*) and produces **`p1s-print.3mf`** — a real sliced project containing the G-code, plate thumbnails and Bambu metadata. Predicted print time and filament grams come straight from the slicer. Send the file to the printer or open it in Bambu Studio as a fully configured project.

### Manual

1. **Export STL** (or **3MF** — a named, millimetre-unit object) from the model panel.
2. Drag it into **Bambu Studio** → printer *Bambu Lab P1S · 0.4 nozzle*.
3. Layer 0.20 mm, 2–3 walls, the infill/material you picked, supports per the model's recommendation.
4. Slice → print.

The SCAD source is exported too — it's parametric; open it in OpenSCAD to tweak dimensions by hand.

## Codex via ChatGPT subscription

- The model list reads your Codex `config.toml` — the **Default** entry uses exactly the model your CLI is configured for (e.g. `gpt-5.6-sol`), and you can pick it explicitly or enter any model id.
- **Sign in with ChatGPT** launches `codex login --device-auth` in a clean process tree (via a WMI relay, so sandboxes/service contexts can't break it): the dialog shows a **one-time code** (click to copy) and opens https://auth.openai.com/codex/device — enter the code, approve, done. No local callback port involved, so nothing can refuse the browser's redirect. The dialog confirms only when the token file is genuinely rewritten (a stale revoked token can't fake it).
- The app keeps its **own Codex home** in `.data/codex-home/` (writable even where `~/.codex` is denied by Codex's sandbox group), seeded from your `~/.codex/config.toml` — model default preserved, terminal auth untouched.
- If a generation ever fails with *"Your Codex session has ended"*, your refresh token was revoked (it happens) — click **Sign in with ChatGPT** again.

## Configuration

`Settings` (⚙) manages the OpenSCAD path + compile timeout, provider endpoints/keys, the Codex model, and **repair attempts** (how many times the compiler's errors are fed back to the model — 3 by default). Everything is stored locally in `.data/settings.json`; nothing leaves your machine except the LLM calls you configure.

## API (the app talks to itself, but it's handy)

| Route | Purpose |
|---|---|
| `POST /api/generate` | NDJSON stream: `log` events, then `result` or `error` |
| `GET /api/health` | OpenSCAD / Codex / Ollama status |
| `GET /api/models?provider=…` | Model list per provider |
| `GET/POST /api/settings` | Read / patch settings |
| `GET /api/generations` · `DELETE ?id=` | History |
| `GET /api/generations/<id>/{stl,scad,thumb,input,3mf}` | Artifacts |
| `POST /api/generations/<id>/slice` | Slice for P1S via Bambu Studio CLI |
| `GET /api/generations/<id>/{sliced,sliceresult}` | Sliced `.3mf` download / slicer stats |

## Troubleshooting

- **"OpenSCAD missing"** — install it or set the path in Settings; the health chip in the header turns green when found.
- **Ollama dot grey** — is `ollama serve` running? Is the model pulled?
- **Codex: "not detected"** — the CLI ships in `node_modules`; if you use a global install instead, it's found via `PATH` or `CODEX_PATH`.
- **Codex asks for login** — Settings → *Sign in with ChatGPT*: a one-time code appears in the dialog and the device page opens; enter the code and approve.
- **Codex "session has ended"** — your refresh token was revoked; sign in again via the button.
- **Slice button missing** — install Bambu Studio (the health chip detects it); profiles live in `resources/bambu/` and can be rebuilt with `node scripts/build-bambu-profiles.mjs`.
- **Generation loops on errors** — lower ambition of the prompt or raise repair attempts; complex lattices can exceed 120 s compile (raise the timeout in Settings).
- **Port 3000 busy** — `pnpm dev -- -p 3100`.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · three.js (STL preview) · OpenSCAD 2021.01 (geometry) · Codex CLI (subscription auth) · Ollama / OpenAI-compatible APIs (local models). Local-first: your prompts, images, keys and models stay on this machine.

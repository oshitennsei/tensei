## Why

The project has a detailed spec (v0.2.0) but no code. Before any feature work can begin — ingestion, RAG, sessions, personas — the Chrome extension itself must exist: a buildable, loadable project with the right structure, tooling, and entry points. This is the foundation everything else builds on.

## What Changes

- Create the Chrome extension project at `extension/` with Manifest V3
- Set up Vite build toolchain with TypeScript, React, and Tailwind CSS
- Register and implement the Side Panel as the primary interaction surface
- Register the background service worker (message routing, lifecycle only)
- Register a minimal content script stub (for future platform scraping)
- Create the extension popup (minimal — opens side panel)
- Establish the full `extension/src/` folder structure matching the spec repo layout
- Configure `manifest.json` with correct permissions (`sidePanel`, `storage`, `host_permissions` for GitHub whitelist and user LLM endpoints)
- Add `index.html` entry points for side panel and popup
- Wire up hot-reload dev workflow and production build

## Capabilities

### New Capabilities

- `extension-core`: The Chrome extension project itself — manifest, build config, entry points (side panel, popup, background, content script), folder structure, and dev/build toolchain. No business logic; just the shell that all other capabilities run inside.

### Modified Capabilities

_(none — greenfield project, no existing specs)_

## Impact

- Creates `extension/` directory (all code lives here)
- Adds `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts` at `extension/` root
- Establishes `extension/src/` layout:
  - `background/` — service worker
  - `content/` — content scripts
  - `popup/` — popup UI
  - `sidebar/` — side panel UI (main surface)
  - `lib/` — shared utilities (empty stubs for: storage, llm, agents, memory, retrieval, ingestion, content-safety, persona)
  - `prompts/` — system prompt files (empty)
- No runtime dependencies on any LLM provider or storage schema yet
- Sets `host_permissions` early so future changes don't require manifest restructuring

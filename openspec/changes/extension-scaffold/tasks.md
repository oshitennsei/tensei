## 1. Project Initialization

- [x] 1.1 Create `extension/` directory at repo root and run `npm init` to produce `package.json`
- [x] 1.2 Add runtime dependencies: `react`, `react-dom`
- [x] 1.3 Add dev dependencies: `vite`, `@crxjs/vite-plugin` (evaluate) or `vite-plugin-web-extension`, `typescript`, `@types/chrome`, `@types/react`, `@types/react-dom`, `tailwindcss`, `postcss`, `autoprefixer`
- [x] 1.4 Create `tsconfig.json` with `"lib": ["ES2020", "DOM"]`, strict mode, and path aliases (`@/` → `src/`)
- [x] 1.5 Add npm scripts: `"dev"`, `"build"`, `"zip"` (zip the dist folder for distribution)

## 2. Build Configuration

- [x] 2.1 Create `vite.config.ts` using `vite-plugin-web-extension` (or chosen plugin), with entry points for background, content, popup, and sidebar
- [x] 2.2 Create `tailwind.config.ts` with content paths covering `src/**/*.{ts,tsx}`
- [x] 2.3 Create `postcss.config.js` with `tailwindcss` and `autoprefixer` plugins
- [x] 2.4 Confirm `npm run build` completes and produces a valid `dist/` directory

## 3. Manifest

- [x] 3.1 Create `src/manifest.json` (source of truth for the plugin, not hand-edited `dist/manifest.json`)
- [x] 3.2 Set `manifest_version: 3`, `name`, `version: "0.1.0"`, `description`, and `minimum_chrome_version: "114"`
- [x] 3.3 Declare permissions: `["sidePanel", "storage", "alarms"]`
- [x] 3.4 Declare `host_permissions`: `["https://raw.githubusercontent.com/*", "<all_urls>"]`
- [x] 3.5 Register `background.service_worker` pointing at the background entry
- [x] 3.6 Register `side_panel.default_path` pointing at `sidebar/index.html`
- [x] 3.7 Set `action` with `default_popup` pointing at `popup/index.html`
- [x] 3.8 Register content script stub with `matches: ["<all_urls>"]` and `run_at: "document_idle"`
- [x] 3.9 Add `content_security_policy.extension_pages: "script-src 'self'; object-src 'self'"`

## 4. Background Service Worker

- [x] 4.1 Create `src/background/index.ts` with `chrome.runtime.onInstalled` handler (logs version, no other logic)
- [x] 4.2 Add `chrome.runtime.onMessage` handler that forwards messages to the side panel port and returns ack
- [x] 4.3 Add `chrome.action.onClicked` handler that calls `chrome.sidePanel.open({ windowId })` to open side panel on toolbar click

## 5. Popup Entry Point

- [x] 5.1 Create `src/popup/index.html` with minimal HTML shell and script tag pointing at `index.tsx`
- [x] 5.2 Create `src/popup/index.tsx` that immediately calls `chrome.sidePanel.open()` and renders a "Opening..." message (closes after 500ms or on side panel open)

## 6. Side Panel Entry Point

- [x] 6.1 Create `src/sidebar/index.html` with minimal HTML shell, Tailwind base styles, and script tag pointing at `index.tsx`
- [x] 6.2 Create `src/sidebar/index.tsx` with React root render mounting `<App />`
- [x] 6.3 Create `src/sidebar/App.tsx` with a stub layout: header bar ("キャラクターが転生してきた件"), placeholder main content area ("Coming soon"), and Tailwind styling
- [x] 6.4 Verify side panel opens when toolbar icon is clicked and shows the stub UI

## 7. Content Script Stub

- [x] 7.1 Create `src/content/index.ts` with a single log statement (`console.log("content script loaded")`) and an exported no-op `activate()` function for future use

## 8. Library Stubs

- [x] 8.1 Create `src/lib/storage/index.ts` — export stub: `// Storage layer — implemented in storage-layer change`
- [x] 8.2 Create `src/lib/llm/index.ts` — export stub: `// LLM client — implemented in llm-client change`
- [x] 8.3 Create `src/lib/agents/index.ts` — export stub: `// Sub-agents — implemented in sub-agents change`
- [x] 8.4 Create `src/lib/memory/index.ts` — export stub: `// Memory management — implemented in memory-architecture change`
- [x] 8.5 Create `src/lib/retrieval/index.ts` — export stub: `// RAG retrieval — implemented in rag-retrieval change`
- [x] 8.6 Create `src/lib/ingestion/index.ts` — export stub: `// Ingestion pipeline — implemented in ingestion-pipeline change`
- [x] 8.7 Create `src/lib/content-safety/index.ts` — export stub: `// Content safety — implemented in content-safety change`
- [x] 8.8 Create `src/lib/persona/index.ts` — export stub: `// Persona management — implemented in persona-system change`
- [x] 8.9 Create `src/prompts/.gitkeep` and `src/tests/.gitkeep` to preserve empty directories in git

## 9. Verification

- [x] 9.1 Load `dist/` as unpacked extension in Chrome — confirm no manifest errors in `chrome://extensions`
- [x] 9.2 Click toolbar icon — confirm side panel opens and shows stub UI
- [x] 9.3 Navigate to a new tab while side panel is open — confirm side panel stays open
- [x] 9.4 Run `npm run build` — confirm clean build with no TypeScript errors
- [x] 9.5 Run `npm run dev` — edit `App.tsx`, confirm side panel hot-reloads without manual extension reload
- [x] 9.6 Inspect `dist/manifest.json` — confirm CSP field is present and correct
- [x] 9.7 Open DevTools → Network tab while extension loads — confirm no requests to external CDNs

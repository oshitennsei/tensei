## ADDED Requirements

### Requirement: Extension installs and loads in Chrome
The extension SHALL be a valid Manifest V3 Chrome extension that can be loaded via `chrome://extensions` in developer mode and distributed through the Chrome Web Store. It SHALL declare the minimum required permissions for current and planned Phase 1–2 features.

#### Scenario: Load unpacked in developer mode
- **WHEN** a developer opens `chrome://extensions`, enables Developer Mode, and clicks "Load unpacked" pointing at the `dist/` folder
- **THEN** the extension loads without errors and appears in the extensions list with its icon and name

#### Scenario: Manifest declares required permissions
- **WHEN** the manifest is inspected
- **THEN** it SHALL declare: `sidePanel`, `storage`, `alarms`, and `host_permissions` including `https://raw.githubusercontent.com/*` and `<all_urls>` (for user-configured LLM endpoints)

#### Scenario: Minimum Chrome version enforced
- **WHEN** the extension is loaded on Chrome < 114
- **THEN** Chrome SHALL display an incompatibility warning (enforced via `minimum_chrome_version: "114"` in manifest)

---

### Requirement: Side panel opens as the primary interaction surface
The extension SHALL register a side panel that opens when the user clicks the extension toolbar icon. The side panel SHALL be the sole interactive surface for all reader and author mode features.

#### Scenario: Toolbar click opens side panel
- **WHEN** a user clicks the extension icon in the Chrome toolbar
- **THEN** the side panel opens at the right edge of the browser window, showing the extension UI

#### Scenario: Side panel persists across navigations
- **WHEN** the side panel is open and the user navigates to a different tab or URL
- **THEN** the side panel remains open and retains its state (it is a page context, not a popup)

#### Scenario: Popup redirects to side panel
- **WHEN** the extension popup is triggered (e.g., keyboard shortcut)
- **THEN** the popup immediately calls `chrome.sidePanel.open()` and closes itself, so the user lands in the side panel

---

### Requirement: Service worker is restricted to lifecycle and routing
The background service worker SHALL handle only: extension lifecycle events (`onInstalled`), message routing between extension contexts (`onMessage`), and Chrome alarm registration (`onAlarm`). It SHALL NOT perform LLM calls, database operations, ingestion, or compression.

#### Scenario: Service worker routes message to side panel
- **WHEN** any extension context sends a message via `chrome.runtime.sendMessage`
- **THEN** the service worker forwards it to the side panel port (if open) and returns an acknowledgement

#### Scenario: Service worker does not perform long-running work
- **WHEN** the service worker receives a request that would require > 5 seconds of processing
- **THEN** it SHALL return an error directing the caller to perform the work in the side panel context instead

---

### Requirement: Vite build produces a loadable extension dist
The build system SHALL produce a `dist/` directory that can be loaded directly as an unpacked Chrome extension. Development mode SHALL support hot-module replacement for the side panel and popup.

#### Scenario: Production build completes successfully
- **WHEN** `npm run build` is executed from the `extension/` directory
- **THEN** a `dist/` folder is produced containing `manifest.json`, all bundled JS/CSS, and static assets with no build errors

#### Scenario: Development build enables hot reload
- **WHEN** `npm run dev` is executed and a source file in `sidebar/` is modified
- **THEN** the side panel reloads automatically without requiring the developer to manually reload the extension

#### Scenario: Build output is self-contained
- **WHEN** the `dist/` folder is loaded as an unpacked extension
- **THEN** the extension functions without any network requests to a development server or external CDN

---

### Requirement: Source folder structure matches spec §13
The `extension/src/` directory SHALL contain the exact folder layout defined in the project spec, with stub entry points for all future modules.

#### Scenario: All required directories exist
- **WHEN** the repository is cloned and `extension/src/` is inspected
- **THEN** the following directories SHALL exist: `background/`, `content/`, `popup/`, `sidebar/`, `lib/storage/`, `lib/llm/`, `lib/agents/`, `lib/memory/`, `lib/retrieval/`, `lib/ingestion/`, `lib/content-safety/`, `lib/persona/`, `prompts/`, and `tests/`

#### Scenario: Each lib directory has a stub entry point
- **WHEN** any file in `lib/` is imported by another module
- **THEN** TypeScript resolves the import without error (each `lib/<name>/index.ts` SHALL export at minimum a placeholder comment and a typed stub)

---

### Requirement: Content Security Policy prevents remote code execution
The extension SHALL enforce a Content Security Policy that prohibits `eval`, inline scripts, and loading scripts from external domains.

#### Scenario: CSP header is present in manifest
- **WHEN** the manifest is inspected
- **THEN** `content_security_policy.extension_pages` SHALL be set to `"script-src 'self'; object-src 'self'"` or stricter

#### Scenario: No external script tags in HTML
- **WHEN** all HTML entry points (`sidebar/index.html`, `popup/index.html`) are inspected
- **THEN** they SHALL contain no `<script src="https://...">` tags pointing to external domains

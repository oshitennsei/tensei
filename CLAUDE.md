# Tensei — Development Guide for Claude

## Project Overview

Chrome extension + Cloudflare portal for immersive novel-character interaction.
Every novel is a universe; the user steps inside as an explorer.

- **Extension**: `extension/` — Chrome Side Panel app (React + Vite + Dexie + Transformers.js)
- **Portal**: `portal/frontend/` — Cloudflare Pages (React + Vite + Tailwind)
- **Worker**: `portal/worker/` — Cloudflare Worker (Hono + D1 + KV)

## Version Release Checklist

When bumping the extension version, always complete ALL of the following steps:

### 1. Version number (do both files)
```
extension/manifest.json   → "version": "X.Y.Z"
extension/package.json    → "version": "X.Y.Z"
```

### 2. Changelog entry (REQUIRED — triggers What's New dialog)

Add a new entry at the **top** of `extension/src/lib/changelog.ts`:

```typescript
{
  version: "X.Y.Z",
  changes: {
    ja:      ["変更点1", "変更点2"],
    "zh-tw": ["變更點1", "變更點2"],
    "zh-cn": ["变更点1", "变更点2"],
    en:      ["Change 1", "Change 2"],
  },
},
```

- All 4 languages are required (ja / zh-tw / zh-cn / en)
- This entry is displayed in-app to users who update from a previous version
- First-time installs show the Welcome dialog (→ 転生学校), not the changelog
- Keep items concise — shown as a bullet list in a small modal

### 3. Build & package extension
```bash
cd extension
npm install
npx vite build
zip -r ../tensei-extension-vX.Y.Z.zip dist/ -x "*.DS_Store"
```

### 4. Deploy portal (if portal changed)
```bash
cd extension && npx vite build --config vite.web.config.ts   # rebuild PWA
cd portal/frontend && npm ci && npm run build
mkdir -p dist/app && cp -r ../../extension/dist-web/. dist/app/
npx wrangler@latest pages deploy dist --project-name tensei-portal --commit-dirty=true --branch main
```

### 5. Commit & GitHub Release
```bash
git add extension/manifest.json extension/package.json extension/src/lib/changelog.ts [other files]
git commit -m "feat: vX.Y.Z — brief description"
git push origin main
gh release create vX.Y.Z tensei-extension-vX.Y.Z.zip \
  --title "vX.Y.Z — short title" \
  --notes "$(cat release-notes.md)"
```

### 6. Chrome Web Store
Upload `tensei-extension-vX.Y.Z.zip` to the Chrome Developer Dashboard.

---

## i18n

### Extension (`extension/src/lib/i18n/index.ts`)
- Languages: `ja` (default) / `zh-tw` / `zh-cn` / `en`
- User sets language in Settings → stored in `db.app_settings`
- Use `useStrings()` for reactive string access in components
- Use `useLang()` when you need the raw `UILanguage` value
- All new UI strings must be added to all 4 language blocks

### Portal (`portal/frontend/src/pages/`)
- `Guide.tsx`: `useState<Lang>` + explicit picker buttons (ja / zh-TW / zh-CN / en)
- `Home.tsx`: `useState<Lang>` initialized from `navigator.language` + picker buttons
- Other pages (Login, Dashboard, Register): Japanese only (author-facing)

---

## Architecture Notes

- `__APP_VERSION__` in extension is injected by Vite from `package.json` at build time
- `tensei_version` in `chrome.storage.local` tracks the last-seen version for the What's New dialog
- Portal ↔ Extension communication: `externally_connectable` + `chrome.runtime.sendMessage`
- Portal ↔ Extension auth: Bearer token stored in `chrome.storage.local` via KV lookup

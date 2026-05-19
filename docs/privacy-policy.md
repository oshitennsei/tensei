# Privacy Policy — Tensei (キャラクターが転生してきた件)

*Last updated: 2026-05-14*

---

## Summary

Tensei stores all your data locally in your browser. We do not collect, transmit, or store any personal information on external servers.

---

## Data we collect

**None.**

Tensei does not collect any personal data, usage data, or analytics. There are no accounts, no sign-ups required to use the extension, and no telemetry of any kind.

---

## Where your data is stored

Everything you do in Tensei — novel text you import, character settings, conversation history, app settings — is stored exclusively in your browser's local IndexedDB storage. This data never leaves your device, except as described below.

---

## LLM API calls

To generate character responses, Tensei sends requests directly from your browser to the LLM API endpoint you configure (e.g. OpenAI, OpenRouter, Ollama, or any OpenAI-compatible endpoint). These requests include:

- The system prompt (character settings + relevant novel passages)
- Recent conversation history

These requests go **directly to the API provider you choose**. Tensei has no intermediate server that handles or logs these requests. The privacy of these calls is governed by your chosen API provider's privacy policy.

Your API key is stored only in your browser's local storage and is never sent to Tensei servers (which do not exist).

---

## Author portal (optional)

If you are an **author** who registers through the Tensei portal ([tensei-portal.pages.dev](https://tensei-portal.pages.dev)):

- Your **email address** is used to send a magic link for authentication. It is stored in our Cloudflare D1 database solely for authentication and communication purposes.
- **Character configuration data** you voluntarily submit (character descriptions, speech styles, etc.) is stored and made available to readers of your work.
- We do not sell or share this data with third parties.

Readers using the extension do **not** need to register or provide any personal information.

---

## Permissions used

The extension requests the following Chrome permissions:

| Permission | Why |
|---|---|
| `storage` | Stores app settings in `chrome.storage.local` |
| `sidePanel` | Displays the main UI in Chrome's side panel |
| `activeTab` | Reads the current page URL to detect supported novel platforms |
| `scripting` | Injects a content script to extract chapter text from novel pages |
| `host_permissions` (kakuyomu.jp, syosetu.com) | Required for the chapter import feature |

No permission is used for tracking, advertising, or data collection.

---

## Data deletion

To delete all your data, open Chrome's settings and clear site data for the extension, or uninstall the extension. All local IndexedDB data will be permanently deleted.

---

## Children's privacy

This extension is not directed at children under 13. We do not knowingly collect any information from children.

---

## Changes to this policy

If this policy changes materially, we will update the date at the top of this document and note it in the release changelog.

---

## Contact

GitHub Issues: [https://github.com/oshitennsei/tensei-extension/issues](https://github.com/oshitennsei/tensei-extension/issues)

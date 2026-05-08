# キャラクターが転生してきた件 (Tensei)

A Chrome extension for immersive roleplay with characters from Japanese web novels.

Connect a character from a story you love to an LLM, and have a real conversation with them — bound by what they actually know up to any chapter you choose.

## Features

- **Chapter-accurate memory** — Characters only know what happened up to the chapter you set
- **Multi-tier memory compression** — Long conversations are compressed without losing key facts
- **RAG-powered context** — Relevant novel passages are retrieved and injected per message
- **Per-character customization** — Persona, speech style, voice samples, dialogue examples, will/won't-do lists
- **Character versioning** — Talk to a character at different points in their arc
- **Reader persona** — Set your preferred response language and reader profile
- **Custom backgrounds** — Per-work and global background images or gradients
- **Bring your own LLM** — OpenAI, OpenRouter, Ollama, or any OpenAI-compatible endpoint; local embedding via Transformers.js

## Installation (development)

```bash
cd extension
npm install
npm run build
```

Then load `extension/dist` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Running tests

```bash
cd extension
npm test        # watch mode
npm run test:run    # single run
npm run test:coverage
```

## Tech stack

| Library | License |
|---|---|
| [React 18](https://react.dev) | MIT |
| [Dexie.js](https://dexie.org) | Apache 2.0 |
| [@huggingface/transformers](https://huggingface.co/docs/transformers.js) | Apache 2.0 |
| [Vite](https://vitejs.dev) | MIT |
| [vite-plugin-web-extension](https://github.com/aklinker1/vite-plugin-web-extension) | MIT |
| [Tailwind CSS](https://tailwindcss.com) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Apache 2.0 |
| [Vitest](https://vitest.dev) | MIT |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | Apache 2.0 |

### Development tools

- [Claude Code](https://claude.ai/code) — AI coding assistant used throughout development

## License

GNU General Public License v3.0 or later — see [LICENSE](./LICENSE).

All dependency licenses are compatible with GPLv3.

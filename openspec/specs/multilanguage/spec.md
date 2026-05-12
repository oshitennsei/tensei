# Multi-language Support Specification

**Status:** Designed — Phase 1 (basic), Phase 2 (glossary)  
**Discussion date:** 2026-05-08  

---

## Problem

A reader who reads a Japanese novel may want to converse with the character
in their native language (Chinese, English, etc.). The current system responds
only in Japanese because all system prompts are written in Japanese.

Similarly, Japanese readers may want to engage with English-language works.

---

## Design

### Two separate language settings

| Setting | Meaning | Where stored |
|---|---|---|
| `work.language` | The novel's original language | `Work` record (existing) |
| `reader_language` | The reader's preferred response language | `Persona` record |

These are independent. The LLM handles comprehension across languages naturally.
The system only needs to instruct the character which language to **respond in**.

---

## Phase 1 — Language preference (implement now)

### Persona language field

Add `language` to the `Persona` type:

```typescript
interface Persona {
  id: string;
  name: string;
  content_md: string;
  applies_to: string[];
  is_default: boolean;
  language: Language;   // NEW: "ja" | "zh" | "en" | "other"
}
```

### System prompt injection

In `chat/index.ts`, append to system prompt when reader language differs from work language:

```
読者の希望言語: 繁體中文
必ず繁體中文で返答してください。
固有名詞（人名・地名・道具名）は原語（日本語）のまま使用してください。
ただし、以下の対照表がある場合はそれに従ってください。
```

### Persona management UI

Add language selector to the Persona editing interface (currently no PersonaScreen exists — to be built):

```
読者設定
  名前: 読者
  言語: [繁體中文 ▼]
  その他の設定: ...
```

### LLM capability assumption

Modern LLMs (GPT-4o, Claude, Gemini) handle cross-language instruction reliably.
No translation pre-processing of ingested text is needed. The character's knowledge
(summaries, key events) is stored in the work's original language; the LLM translates
on-the-fly when responding.

---

## Phase 2 — Work glossary (author-provided)

For proper nouns that require consistent translation (character names rendered
differently across languages, special terms with cultural weight):

### WorkGlossary type

```typescript
interface GlossaryEntry {
  original: string;                            // "勇者の剣"
  translations: Partial<Record<Language, string>>;  // { zh: "勇者之劍", en: "Hero's Sword" }
  notes?: string;                              // "この剣は物語の核心。訳語を統一すること"
}

interface WorkGlossary {
  work_id: string;
  entries: GlossaryEntry[];
}
```

### System prompt injection (Phase 2)

When a glossary exists and reader language differs from work language:

```
固有名詞対照表:
- 勇者の剣 → 勇者之劍
- 鈴木太郎 → 鈴木太郎（固有名詞のため原語保持）
- 魔王城 → 魔王城（同上）
```

### Author workflow (Phase 2)

Authors provide `glossary.json` alongside character configs in `tensei-authors`:

```json
{
  "entries": [
    {
      "original": "勇者の剣",
      "translations": { "zh": "勇者之劍", "en": "Hero's Sword" },
      "notes": "主人公の象徴。訳語を統一すること。"
    }
  ]
}
```

---

## Character name localization

Character names are stored as `canonical_name` (original language) with `aliases`.
For cross-language use, the alias system can carry translated names:

```json
{
  "canonical_name": "鈴木太郎",
  "aliases": ["タロウ", "Suzuki Taro", "铃木太郎"]
}
```

The UI shows `canonical_name` but the LLM can match user references in any language
against the aliases array.

---

## Non-goals

- Machine translation of ingested novel text (not needed; LLM handles this at response time)
- UI localization of the extension itself (separate concern)
- Right-to-left language support (Arabic, Hebrew) — deferred

---

## Current state of implementation

The current chat system only works reliably in Japanese because:
1. All system prompt instructions are in Japanese
2. No reader language preference is stored
3. The LLM defaults to the language it sees most (Japanese from ingested text)

**Minimum fix for Phase 1:** Add `language` field to `Persona`, inject response-language
instruction in system prompt. No glossary needed at this stage.

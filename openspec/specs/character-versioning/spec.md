# Character Versioning Specification

**Status:** Designed — Phase 1 (extension) partially, Phase 2 (full UI)  
**Discussion date:** 2026-05-08  

---

## Problem

A character's personality, speech, and knowledge change across a story:
- Linear growth: trauma, aging, relationships
- Non-linear: flashback scenes showing childhood, dream sequences, alternate timelines

The naive solution — mapping chapter number to personality — fails when a chapter
contains a flashback in the middle. A single chapter can include multiple eras.

---

## Core Design Principle

**Two independent axes, reader-controlled:**

| Parameter | Controls | Set by |
|---|---|---|
| `cutoff_chapter` | What the character **knows** (spoiler prevention) | Reader |
| `character_version` | Which era's **personality** to use | Reader (explicit choice) |

These are orthogonal. A reader at chapter 10 can choose to chat with the childhood
version of a character — who knows only what happened before chapter 10's cutoff.

The system does **not** attempt to automatically detect which passage of a chapter
is a flashback. This is technically unreliable and UX-confusing. Instead, the reader
makes an explicit, conscious choice.

---

## Extended CharacterStateSnapshot

### Current schema (insufficient)

```typescript
interface CharacterStateSnapshot {
  at_chapter: number;
  knowledge: string[];
  emotional_state: string;
  relationships: Record<string, string>;
}
```

### Proposed schema

```typescript
interface CharacterStateSnapshot {
  id: string;                      // stable identifier
  label: string;                   // reader-facing name: "少年時代", "成長後"
  character_age?: string;          // "7歳頃", "17歳" — optional, for display
  from_chapter?: number;           // hint: which chapter this state begins
                                   // null = timeline-independent (e.g., flashback)
  is_selectable: boolean;          // show in reader's version picker
  persona_override?: string;       // replaces base persona if set
  speech_style_override?: string;  // replaces base speech_style if set
  change_reason?: string;          // author internal note: "第5章の喪失後"
  // existing fields retained:
  knowledge: string[];
  emotional_state: string;
  relationships: Record<string, string>;
}
```

**Key decisions:**
- `from_chapter: null` = timeline-independent snapshot (flashback, childhood memory)
  not tied to a narrative chapter
- `persona_override` only overrides if set; `null/undefined` falls back to base persona
- `is_selectable: false` for internal snapshots the reader shouldn't see

---

## Version Selection Logic

### In `buildContext` (retrieval layer)

```
Given: cutoff_chapter, selected character_version_id

1. Load CharacterExtended (base persona, speech_style)
2. Find snapshot where snapshot.id === character_version_id
3. effectivePersona   = snapshot.persona_override   ?? characterExt.persona
4. effectiveSpeechStyle = snapshot.speech_style_override ?? characterExt.speech_style
5. Inject effectivePersona and effectiveSpeechStyle into system prompt
6. cutoff_chapter still controls which chapters' summaries and events are included
```

### Default version

When starting a new chat without specifying a version:
- If `from_chapter` snapshots exist: use the snapshot with highest `from_chapter <= cutoff_chapter`
- If no snapshots: use base CharacterExtended directly

---

## NewChatScreen UI

```
キャラクター: 鈴木太郎

バージョンを選ぶ:           ← only shown if is_selectable snapshots exist
  ● 成長後（17歳, 第5章〜）  ← default: highest from_chapter ≤ cutoff
  ○ 転生直後（17歳, 第1章〜）
  ○ 少年時代（7歳頃）        ← from_chapter: null, still selectable

既読章（知識の制限）: 第8章まで ████████░░░
```

The version picker is hidden when the character has no selectable snapshots,
preserving the simple UX for straightforward characters.

---

## Author workflow in CharacterEditScreen

New "成長・変化の記録" section:

```
[+ バージョンを追加]

── 少年時代（回想）────────────────
  ラベル:         少年時代（回想）
  年齢:           7歳頃
  適用開始章:     なし（時系列外）
  読者に表示:     ✓
  ペルソナ変更:   無邪気で怖いもの知らず...
  話し方変更:     「〜だもん」「〜だよ！」
  メモ:           第10章の回想シーン
  [編集] [削除]

── 喪失後（第5章〜）───────────────
  ラベル:         喪失後
  年齢:           17歳
  適用開始章:     第5章
  読者に表示:     ✓
  ...
```

---

## Handling "a chapter contains a brief flashback"

The spec's answer: **do nothing automatically.**

If chapter 10 is mostly present-day but has a 2-page flashback to childhood:
- The main personality used is the present-day version (selected by reader)
- If a reader specifically wants to explore the childhood version, they select it manually
- The author may add a note in `change_reason` explaining which scenes relate to
  which snapshot, for their own reference

This is correct because the chat interface is about reader **exploration**, not
automatic re-enactment of specific passages. The reader chooses their experience.

---

## Migration

`CharacterStateSnapshot` extension is additive. Existing snapshots stored with the
old schema remain valid (new fields are optional). No DB migration needed.

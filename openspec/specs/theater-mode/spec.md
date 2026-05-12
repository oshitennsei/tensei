# Theater Mode Specification

**Status:** Designing — Phase 5 implementation  
**Branch:** `feat/phase5-theater`  
**Discussion date:** 2026-05-09  

---

## Overview

Phase 4 introduced a basic performance mode where the LLM generates script-format scenes immediately after the user selects characters and settings. Phase 5 redesigns this into a structured **production workflow** that mirrors how a real drama production operates:

```
ユーザー記述 → 演出計画の生成 → 計画の確認・修正 → 演出開始
```

Additionally, BTS (Behind the Scenes) mode is enriched with auto-generated crew, user-specified locations and scenarios, and crew interactions woven into the main performance.

---

## Phase 5A — Production Planning (演出計画)

### Problem with Phase 4

In Phase 4, the user selects characters and presses "開始" — the LLM immediately starts generating scenes with no shared understanding of what the scene is. This produces inconsistent, unfocused content.

### Solution: 5W1H Planning Step

Before any scene is generated, the system produces a structured **production plan** that both the user and the LLM use as the anchor for the entire session.

### New UX Flow

```
WorkScreen
  └→ PerformanceSetupScreen       ← (existing) select characters, chapter, mode, improv
       └→ SceneBriefScreen        ← (NEW) user describes scene in natural language
            └→ ProductionPlanScreen  ← (NEW) AI generates plan, user reviews/edits
                 └→ PerformanceScreen   ← (existing, receives plan as context
```

### SceneBriefScreen

The user describes the scene they want in natural language. Examples:

- 「第3章のエレナと国王の謁見シーン」
- 「物語の後日談。戦争が終わって2年後、エレナが故郷に戻ってくる場面を作りたい」
- 「完全な番外篇。エレナとソフィアが温泉旅館でくつろぐ話」

Fields:
- `scene_basis`: `"chapter" | "post_story" | "spinoff" | "virtual"`  
  (ユーザーが選択 or AI が記述から推定)
- `reference_chapter?`: 参照する章番号（chapter の場合）
- `user_description`: 自由記述テキスト（制限なし）

### ProductionPlanScreen

The AI reads the user's description and the referenced chapter (if any) and generates a `ProductionPlan`. The user sees it as an editable card and can modify any field before proceeding.

### ProductionPlan Schema

```typescript
interface SceneBeat {
  order: number;
  description: string;   // 「エレナが謁見室に入る」「国王が文書を突きつける」
}

interface ProductionPlan {
  id: string;
  performance_session_id: string;
  created_at: number;

  // 5W1H
  who: string[];           // キャスト名（entity canonical names）
  where: string;           // 「王城の謁見室、正午」
  when: string;            // 「戦勝の翌日、夕刻」
  what: string;            // 一文で要約：「エレナが戦勝報告に謁見するが隠された真実と対峙する」
  why: string;             // 動機・背景：「国王はエレナの忠誠を試している」
  how: string;             // 演出のトーン・手法：「緊張感のある対話劇。台詞中心」

  // Extended fields
  props: string[];         // 「勅書」「エレナの剣」「封蝋」
  tone_tags: string[];     // 「緊張」「疑惑」「権力の非対称」
  beats: SceneBeat[];      // 幕の流れ（3〜6項目推奨）
  scene_basis: "chapter" | "post_story" | "spinoff" | "virtual";
  reference_chapter?: number;
  canonicity: Canonicity;  // "re_enactment" | "extension" | "speculation" | "alternate"

  // Editable by user
  user_notes?: string;     // ユーザーが自由に補足できるメモ欄
}
```

### ProductionPlanScreen UI

```
┌─────────────────────────────────────────┐
│ 演出計画                          ✎ 編集 │
├─────────────────────────────────────────┤
│ 場所・時間  王城の謁見室 / 戦勝の翌日夕刻  │
│ 出演        エレナ、国王              │
│ 概要        エレナが謁見し…           │
│ 道具        勅書、剣、封蝋            │
│ トーン      緊張、疑惑               │
├─ 幕の流れ ──────────────────────────────┤
│ 1. エレナが謁見室に入場する             │
│ 2. 国王が形式的な謝辞を述べる           │
│ 3. エレナが違和感に気づく              │
│ 4. 国王が文書を突きつける              │
│ 5. 対峙と決断                     │
├─────────────────────────────────────────┤
│ [計画を修正]          [演出を開始 →]    │
└─────────────────────────────────────────┘
```

Editing opens an inline form for each field. Beats are reorderable (drag-and-drop, same pattern as batch import).

### LLM prompt for plan generation

```
以下の情報をもとに演出計画をJSON形式で生成してください。

作品: {work.title}
参照章: {chapter.summary_short if applicable}
出演予定: {selected character names}
ユーザーの説明: {user_description}

出力フォーマット: ProductionPlan JSON（who/where/when/what/why/how/props/tone_tags/beats/canonicity）
beatは3〜6項目。日本語で出力。JSONのみ返却。
```

### DB change

Add `production_plans` table to Dexie:

```typescript
// types.ts addition
interface ProductionPlan { ... }  // as above

// db.ts version 6
this.version(6).stores({
  production_plans: "&id, performance_session_id",
});
```

### PerformanceScreen receives plan

`PerformanceSession` gets a new optional field:

```typescript
interface PerformanceSession {
  ...
  production_plan_id?: string;   // links to ProductionPlan
}
```

`generateNextScene` loads the plan and injects it into the system prompt:

```
演出計画:
- 場所: {where}
- 時間: {when}
- 出演: {who.join('、')}
- 概要: {what}
- 背景: {why}
- トーン: {tone_tags.join('、')}
- 現在の幕: ビート {current_beat_index + 1}/{beats.length} — {beats[current_beat_index].description}
```

This gives every subsequent scene generation a stable anchor.

---

## Phase 5B — Enhanced BTS (幕後花絮)

### Current state (Phase 4)

`BtsSession` has `present_crew: BtsCrewMember[]` in the schema but the UI always sets it to `[]`. Crew generation is not implemented.

### Phase 5B additions

#### User-specified BTS scenario

Replace the current "BTS is auto-started after performance setup" with a **BTS brief screen**:

```
どんな楽屋シーンを作りますか？
[例: 化粧室でエレナ役の声優と監督が次の幕を相談している]
```

AI generates:
- `location`: `"makeup_room"` | `"set"` | `"rest_area"` | `"cafeteria"`
- `present_performers`: 指定された演者
- `present_crew`: 自動生成（後述）

#### Auto-generated crew

Based on the production plan scale and BTS location, generate a crew list:

| Location | Default crew generated |
|---|---|
| `makeup_room` | ヘアメイク担当、衣装担当 |
| `set` | 照明、収音、道具担当、場記 |
| `rest_area` | スタッフ（汎用）、ケータリング |
| `cafeteria` | 臨演・エキストラ（会話に混ざることも） |

Each `BtsCrewMember` is generated by LLM with a short persona:

```typescript
interface BtsCrewMember {
  role: string;           // 「照明担当」「場記」「ヘアメイク」
  name: string;           // 架空の名前
  persona_snippet: string; // 「口数が少なく几帳面。照明への拘りが強い」
}
```

Crew members speak occasionally but don't dominate. The reader addresses a specific performer; crew members interject naturally (once per several turns).

#### BTS chat with crew interjection

In `btsChat`, add a `crew_interjection_chance` parameter (default 0.15). After each performer response, with that probability, a random crew member adds a one-liner.

---

## Phase 5C — Actor Persona Settings (演者人格)

### Current state (Phase 4)

`getOrCreateSkill()` auto-generates a `PerformerSkill` via LLM when none exists. There is no UI to view or edit these.

### Phase 5C additions

#### PerformerSkillScreen

New screen accessible from CharacterEditScreen (tab: "演者") or from BtsScreen header.

Shows the auto-generated skill and allows editing:
- 口調・話し方 (`casual_style`)
- 趣味・関心 (`off_set_interests`)
- 口癖やクセ (`quirks`)
- 演技スタイル (`signature_style.acting_method`)
- このキャラクターとの対比 (`contrast_with_role_hints`)

"LLMで再生成" button regenerates from scratch.

---

## Phase 5D — Crew Interactions during Performance (演出中の劇組)

### Design principle

Crew interactions should **never be intrusive**. They are:
- Short (1〜2 lines max per interjection)
- Visually distinct from the main script (gray, italicized, prefixed with role)
- User-triggered or very infrequent automatic

### Implementation options

**Option A — User-triggered buttons (recommended for 5D)**

Below the direction input, add a small crew action bar:

```
[カット！] [道具確認] [音声チェック] [監督コメント]
```

Each button inserts a crew interjection into the scene generation context, which the LLM then incorporates into the next segment.

**Option B — Probabilistic (deferred to 5E or later)**

After every N beats (configured by user), a crew interjection appears automatically. Risk: annoying. Defer until user testing confirms demand.

### Display

```
── 道具担当が小道具を調整している ──
  監督: 「エレナ、もう少し間を取って。台詞が重なる」
─────────────────────────────────────
```

Rendered as a `<aside>` element with distinct styling, sandwiched between scene segments.

---

## Phase 5E — Per-Actor LLM Sessions (Optional)

### Trade-off summary

| | Shared LLM | Per-actor sessions |
|---|---|---|
| API cost | ×1 | ×(number of actors) |
| Character consistency | Medium | High |
| Implementation complexity | Low | High (session routing) |
| Suitable for | General use | Dedicated users |

### Decision

**Default: shared LLM.** A single LLM receives a system prompt with all characters clearly separated. Strong character-specific instructions (persona, speech_style, locked_fields) compensate for the lack of session isolation.

**Optional setting** (`app_settings`): `per_actor_sessions: boolean` (default `false`). When enabled, each actor's turns are routed to a separate `LlmClient` instance with its own conversation history.

This setting is **not in Phase 5 scope**. It requires significant architectural work (session multiplexing, cost management) and should be validated through user feedback first.

---

## Implementation Order and Dependencies

```
Phase 5A (Production Planning)
  ├─ SceneBriefScreen (new)
  ├─ ProductionPlanScreen (new)
  ├─ ProductionPlan schema + DB v6
  ├─ lib/performance: generatePlan(), updated generateNextScene()
  └─ PerformanceSetupScreen: adds brief step

Phase 5B (Enhanced BTS)
  ├─ Depends on: Phase 5A (production plan sets the context for BTS brief)
  ├─ BtsBriefScreen (new)
  ├─ lib/bts: generateCrew(), updated createBtsSession(), crew interjection logic
  └─ BtsScreen: shows crew, location UI

Phase 5C (Actor Persona UI)
  ├─ Depends on: Phase 4 (PerformerSkill already generated)
  ├─ PerformerSkillScreen (new)
  └─ CharacterEditScreen: add "演者" tab

Phase 5D (Crew in Performance)
  ├─ Depends on: Phase 5A (need production plan for crew context)
  ├─ PerformanceScreen: add crew action bar
  └─ lib/performance: generateCrewInterjection()

Phase 5E (Per-actor sessions)
  └─ Deferred — out of scope for Phase 5
```

---

## Out of Scope (Phase 5)

- Per-actor LLM sessions (Phase 5E — deferred)
- Automatic crew interjections (probabilistic) — user-triggered only in 5D
- Author entering the scene as a character — deferred (complex identity management)
- Export of production plan as PDF/script format — deferred
- Multi-user collaboration (two readers on the same performance) — out of scope entirely

---

## Open Questions

1. **ProductionPlan editability**: Should beats be fully free-text editable, or should we constrain to reorder + description edit only?  
   → Recommendation: free-text per beat, with reorder drag-and-drop.

2. **Canonicity default**: For `spinoff`/`virtual` scenes, default to `"speculation"`; for chapter re-enactments default to `"re_enactment"`. Allow user to override.

3. **BTS crew persona depth**: Should crew have extended personalities (hobbies, relationships with actors) or just a one-line `persona_snippet`?  
   → Phase 5B: one-line only. Extend in 5C if demand exists.

4. **Plan regeneration**: If the user heavily edits the plan, should they be able to "lock" specific fields so re-generation doesn't overwrite them?  
   → Yes. Add `locked_plan_fields?: (keyof ProductionPlan)[]` to the schema.

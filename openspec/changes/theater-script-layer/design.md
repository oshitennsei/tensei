## Context

Phase 5A shipped `generatePlan` and `ProductionPlanScreen`. The plan describes beats with character lists, locations, mood, and intent — but the actor LLM never received a complete screenplay. Beat generation relied on a sliding-window slice of the reference chapter; the window was difficult to position accurately, causing the actor to invent events.

The script-first architecture inserts one step: full-chapter script generation. The screenplay is stored and user-editable. Performance reads from it directly.

## Goals / Non-Goals

**Goals:**
- Generate a complete screenplay for all plan beats in a single LLM call (full chapter text in context)
- Store scripts in IndexedDB; associate via `script_id` on `PerformanceSession`
- User can paste-edit the script text before starting performance
- Export script as `tensei-script-v1` JSON; import via drag-and-drop
- Importing a script without a matching novel creates a Stub Work so performance can still run
- `generateNextScene` uses `script.beats[progress].screenplay` exclusively; no source chunks

**Non-Goals:**
- Rich script editor (too large for sidebar; textarea + paste is sufficient)
- Per-character LLM assignment (PerformerSkill integration — next round)
- Accident/improv events (deferred)
- Multi-LLM scene direction (deferred)
- Actor personality snapshots in Script record (deferred; uses live DB character at performance time)

## Decisions

### Script as single DB record with beats array

`Script` stores `beats: ScriptBeat[]` inline. `ScriptBeat = { order: number; beat_label: string; screenplay: string }`. A flat array is sufficient; beats do not need their own store. The screenplay field is free-form text — a few paragraphs the actor LLM can speak/act from.

### LLM prompt: full chapter text + plan → screenplay

`generateScript` builds a single system + user message:
- System: "You are a playwright. Given a novel chapter and a production plan, write a screenplay for each beat. Each beat section starts with `## Beat N — <label>` and contains 2–4 paragraphs of stage directions and dialogue."
- User: plan JSON (stringified) + full chapter text (all chunks concatenated in order)

The response is parsed by splitting on `## Beat` headers. If parsing fails or beat count mismatches, the raw text is placed in beat 0 and the user can re-edit.

### Streaming via async generator

`generateScript` is an async generator that yields `{ type: "progress", text: string }` tokens and finally `{ type: "done", script: Script }`. ScriptScreen consumes the stream and displays a live preview textarea.

### Import validation

`importScript(json)` checks `json.format === "tensei-script-v1"`. If `work_id` is present and matches a DB work, it links. Otherwise it searches by `work_title + work_author`. If no match, creates a Stub Work (`source: "stub"`, title from JSON). Returns the saved `Script`.

### Export format

```json
{
  "format": "tensei-script-v1",
  "work_title": "...",
  "work_author": "...",
  "chapter_number": 13,
  "style_hint": "...",
  "source": "generated",
  "created_at": "...",
  "beats": [
    { "order": 0, "beat_label": "幕次一", "screenplay": "..." }
  ]
}
```

`work_id` is NOT exported (internal DB key, meaningless to other users).

### DB version bump: v2 adds `scripts` store

`db.version(2).stores({ scripts: "&id, work_id, chapter_number" })`. No migration of existing data needed.

### Stub Work

A Stub Work is a `Work` record with `source: "stub"`, `title` from the script JSON, `author` if present, and all other fields empty/null. It satisfies FK constraints and lets performance run. The user can later load the real novel and the script will relink by title match.

### generateNextScene simplification

When `session.script_id` is set:
1. Load `Script` from DB
2. Retrieve `script.beats[session.scene_progress].screenplay`
3. Pass screenplay as the sole reference text in the actor prompt
4. Remove all source_chunk_ids, sliding-window, embedding scoring, and search_passages anchor code

When `session.script_id` is null (legacy sessions): existing path unchanged as a fallback.

### Drag-and-drop at sidebar root

`App.tsx` wraps the screen area in a drop zone div. On `dragover`, show a translucent overlay "放開以載入劇本 (tensei-script-v1)". On `drop`, read the file, call `importScript`, navigate to ScriptScreen. Invalid files show a toast error. Drop target is the entire sidebar, so users do not need to find a specific button.

### HomeScreen secondary entry point

A small "匯入劇本" button on the HomeScreen works list page opens a hidden `<input type="file" accept=".json">` for users who prefer click-to-open over drag-and-drop.

## Risks / Trade-offs

- **Large prompt**: Full chapter (~30–80K chars) + plan (~3K chars) may exceed context windows of small models. Mitigation: graceful error with user-friendly message suggesting a model with larger context window.
- **Parse failure on screenplay**: LLM might not use exact `## Beat N` header format. Mitigation: fallback to single-beat raw text; user can fix via textarea.
- **Stub Work orphans**: Importing scripts without novels creates Stub Works that accumulate. Mitigation: Stub Works are visually marked; user can delete from HomeScreen (future).
- **Legacy sessions**: Existing performance sessions without `script_id` still use the old source_chunk_ids path. Acceptable; those sessions predate this change.

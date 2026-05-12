## Why

Beat generation currently injects a sliding-window slice of the reference chapter into the actor LLM. After ~20 iterations of tuning the window selection algorithm (keyword scoring → embedding cosine → search_passages anchor), the model still invents fictional events because it sees only a fragment of the chapter and lacks the full dramatic arc.

The root cause is architectural: the actor LLM never had a complete picture of what is supposed to happen in each beat. A script generation step — where a dedicated LLM reads the full chapter text plus the production plan and writes a complete screenplay — resolves this permanently. The actor LLM then receives the exact screenplay text for its beat and performs it; it cannot invent events that are not on the page.

## What Changes

- Add a Script generation step between production plan and performance start
- Store generated scripts in IndexedDB; allow import/export as JSON
- ScriptScreen lets the user read, edit (paste-friendly textarea), and start the performance
- PerformanceScreen reads screenplay text from the Script record instead of fetching source chunks
- Remove the sliding-window source_chunk_ids mechanism from `generateNextScene`
- Global drag-and-drop on the sidebar accepts `tensei-script-v1` JSON files

## Capabilities

### New Capabilities

- `script-generation`: `generateScript(session, plan, work, signal?)` — sends full chapter text + plan to the scene LLM, returns a `Script` with one `ScriptBeat` per plan beat; yields streaming progress.
- `script-storage`: `Script` and `ScriptBeat` types; `scripts` Dexie table (DB version bump); `importScript`, `exportScript`, `getScript` helpers.
- `script-screen`: `ScriptScreen` component — shows all beat screenplay text in a scrollable list, provides a single textarea for paste-editing the whole script JSON, Export button, Start Performance button.
- `script-import-drop`: Sidebar-level drag-and-drop handler that validates `format === "tensei-script-v1"` and navigates to ScriptScreen with the imported script.

### Modified Capabilities

- `performance-session`: `PerformanceSession` gains `script_id?: string`; `generateNextScene` loads the Script and uses `script.beats[progress].screenplay` as the actor LLM's ground-truth input instead of fetching source chunks.
- `production-plan-screen`: "開始演出" button renamed to "生成劇本" and navigates to ScriptScreen instead of directly to PerformanceScreen.

## Impact

- DB version bump (v2): adds `scripts` object store
- Removes source_chunk_ids window selection from `generateNextScene` (dead code deleted)
- Adds `extension/src/lib/script/index.ts` and `extension/src/sidebar/screens/ScriptScreen.tsx`
- Updates `App.tsx` screen union, navigation wiring, drag-and-drop
- No changes to ingestion, RAG, or chat flows

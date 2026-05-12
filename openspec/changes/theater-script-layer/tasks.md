## 1. Types & Storage

- [x] 1.1 Add `ScriptBeat` interface to `src/lib/storage/types.ts`: `{ order: number; beat_label: string; screenplay: string }`
- [x] 1.2 Add `Script` interface to `src/lib/storage/types.ts`: `{ id, work_id, chapter_number?, performance_session_id?, created_at, updated_at, source: "generated"|"imported", style_hint?, beats: ScriptBeat[], work_title, work_author? }`
- [x] 1.3 Add `script_id?: string` to `PerformanceSession` interface in `types.ts`
- [x] 1.4 Bump DB to version 8 in `src/lib/storage/db.ts`: add `scripts` store with index `"&id, work_id, chapter_number"`
- [x] 1.5 Add typed `scripts` table property to `TenseiDb` class
- [x] 1.6 Verify `tsc --noEmit` passes (no new errors introduced)

## 2. Script Library (`src/lib/script/index.ts`)

- [x] 2.1 Create `src/lib/script/index.ts`
- [x] 2.2 Implement `generateScript(session, plan, signal?)` as async generator — yields `{ type: "progress", token: string }` and finally `{ type: "done", script: Script }`
- [x] 2.3 Build LLM prompt: system (playwright instruction) + user (plan summary + full chapter chunks concatenated)
- [x] 2.4 Parse streaming response: split on `## Beat N` headers, populate `ScriptBeat[]`; fallback to single beat on parse failure
- [x] 2.5 Save completed `Script` to `db.scripts` and update `session.script_id`
- [x] 2.6 Implement `getScript(script_id: string): Promise<Script | undefined>`
- [x] 2.7 Implement `exportScript(script: Script): string` — serialize to `tensei-script-v1` JSON (omit work_id)
- [x] 2.8 Implement `importScript(json: unknown): Promise<Script>` — validate format, match/create Stub Work, save to DB

## 3. generateNextScene Update (`src/lib/performance/index.ts`)

- [x] 3.1 Import `getScript` from `@/lib/script`
- [x] 3.2 If `session.script_id` is set: load Script, extract `script.beats[beatIndex].screenplay` as reference text
- [x] 3.3 Script-first path injects screenplay as sole reference block in actor system prompt
- [x] 3.4 Legacy path (sliding-window source chunks) retained inside `else` branch for sessions without `script_id`

## 4. ScriptScreen (`src/sidebar/screens/ScriptScreen.tsx`)

- [x] 4.1 Create `ScriptScreen.tsx`
- [x] 4.2 On mount: if `session.script_id` load existing Script; else start `generateScript` stream
- [x] 4.3 Show generation progress: live-updating textarea as tokens arrive
- [x] 4.4 After generation / on load: display final script in editable textarea (markdown format)
- [x] 4.5 "匯出劇本" / "劇本を書き出す" button: calls `exportScript`, triggers download
- [x] 4.6 "開始演出" button: saves edits back to DB, calls `onStartPerformance`
- [x] 4.7 "← 返回" button calls `onBack`

## 5. App.tsx Updates

- [x] 5.1 Add `"script"` to the `Screen` union type in `App.tsx`
- [x] 5.2 Add `ScriptScreen` import
- [x] 5.3 Wire navigation: ProductionPlanScreen `onStart` → `"script"` screen
- [x] 5.4 Wire ScriptScreen `onStartPerformance` → `"performance"` screen
- [x] 5.5 Add sidebar-level drag-and-drop: `onDragEnter`, `onDragLeave`, `onDragOver`, `onDrop` handlers
- [x] 5.6 On valid drop: call `importScript`, create stub session, navigate to `"script"`
- [x] 5.7 On invalid drop: show error toast (3s auto-dismiss)
- [x] 5.8 Show drag hover overlay with "放開以載入劇本" text while dragging

## 6. ProductionPlanScreen Update

- [x] 6.1 Rename button label via i18n (`plan_screen_start` → "劇本生成 →")
- [x] 6.2 `onStart(plan)` now navigates to `"script"` screen instead of `"performance"`

## 7. HomeScreen Import Button

- [x] 7.1 Add hidden `<input type="file" accept=".json">` to HomeScreen
- [x] 7.2 Add "匯入劇本" / "劇本を読み込む" button in header that triggers the file input
- [x] 7.3 Add `onImportScript` prop; on file selected: call `importScript`, navigate to `"script"` screen

## 8. i18n

- [x] 8.1 Add script_screen_title, script_screen_generating, script_screen_edit_hint, script_export, script_start_performance, script_import_drop_hint, script_import_button, script_import_error, script_beat_label, script_gen_system, script_gen_beat_count_hint, script_gen_format_hint, script_gen_chapter_label to all 4 locales

## 9. Verification

- [x] 9.1 `tsc --noEmit` — no new errors
- [x] 9.2 `npm run build` — clean
- [ ] 9.3 Generate a script from ProductionPlanScreen — confirm tokens stream and all beats are populated
- [ ] 9.4 Edit a beat screenplay in the textarea, start performance — confirm actor uses edited text
- [ ] 9.5 Export script as JSON — confirm `format === "tensei-script-v1"` and all beats present
- [ ] 9.6 Drag-and-drop exported JSON onto sidebar — confirm ScriptScreen loads with imported beats
- [ ] 9.7 Import script with no matching novel — confirm Stub Work created and performance still runs

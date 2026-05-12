## 1. Dependency

- [x] 1.1 Add `dexie@^4` to `extension/package.json` dependencies and run `npm install`

## 2. Type Definitions

- [x] 2.1 Create `src/lib/storage/types.ts` — `Work`, `Chapter`, `Scene`, `Chunk` interfaces
- [x] 2.2 Add `Entity`, `Event`, `Timeline` interfaces to `types.ts`
- [x] 2.3 Add `CharacterExtended`, `Session`, `Persona`, `LlmConfig` interfaces to `types.ts`
- [x] 2.4 Add `CacheSubagent`, `AuthorizationLocal` interfaces to `types.ts`
- [x] 2.5 Add performance/BTS interfaces: `PerformanceTemplate`, `PerformerSkill`, `PerformanceSession`, `PerformanceSceneExtended`, `BtsSession`, `CommunityThirdPartySource` to `types.ts`
- [x] 2.6 Verify `tsc --noEmit` passes with zero errors on `types.ts`

## 3. Database Schema

- [x] 3.1 Create `src/lib/storage/db.ts` — define `TenseiDb` class extending `Dexie`
- [x] 3.2 Declare typed table properties for all 17 stores on `TenseiDb`
- [x] 3.3 Add `version(1).stores(...)` with all stores and their index strings
- [x] 3.4 Export `db` singleton (single `new TenseiDb()` instance)
- [x] 3.5 Re-export `db` and all types from `src/lib/storage/index.ts`

## 4. Index Strings (verify each store)

- [x] 4.1 `works`: `"&id"`
- [x] 4.2 `chapters`: `"&id, work_id, chapter_number"`
- [x] 4.3 `scenes`: `"&id, chapter_id"`
- [x] 4.4 `chunks`: `"&id, chapter_id, scene_id, [chapter_id+scene_id]"`
- [x] 4.5 `entities`: `"&id, type, work_id, *aliases"`
- [x] 4.6 `events`: `"&id, chapter_id, scene_id, *participants"`
- [x] 4.7 `timelines`: `"&id, work_id"`
- [x] 4.8 `characters_extended`: `"&id, work_id"`
- [x] 4.9 `sessions`: `"&id, [work_id+character_id], last_active"`
- [x] 4.10 `personas`: `"&id, is_default"`
- [x] 4.11 `llm_configs`: `"&id, role"`
- [x] 4.12 `cache_subagent`: `"&cache_key, session_id, created_at"`
- [x] 4.13 `authorizations_local`: `"&work_identifier, status"`
- [x] 4.14 `performance_templates`: `"&id"`
- [x] 4.15 `performer_skills`: `"&id"`
- [x] 4.16 `performance_sessions`: `"&id"`
- [x] 4.17 `performance_scenes_extended`: `"&id"`
- [x] 4.18 `bts_sessions`: `"&id"`
- [x] 4.19 `community_third_party_sources`: `"&source_url"`

## 5. Verification

- [x] 5.1 Run `npm run build` — confirm clean build with no TypeScript errors
- [ ] 5.2 Open the extension side panel in Chrome, open DevTools → Application → IndexedDB — confirm `tensei` database appears with all 17 stores after first interaction

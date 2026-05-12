## Why

The extension needs a persistent local database. Every other Phase 1 feature — ingestion, sessions, personas, RAG retrieval — reads and writes structured data. Without a storage layer, nothing can be built on top. IndexedDB is the only option with sufficient capacity (~50–80 MB per novel) and the right lifetime guarantees for a browser extension.

## What Changes

- Add Dexie.js as the IndexedDB ORM dependency
- Implement the full database schema from spec §4 across all object stores
- Expose a typed `db` singleton used by all other `lib/` modules
- Replace the `src/lib/storage/index.ts` stub with a real implementation

## Capabilities

### New Capabilities

- `storage-schema`: The IndexedDB database definition — all object stores, field types, indexes, and the Dexie schema version/migration setup. Covers every store from spec §4.2 including the performance/BTS stores. Does not include query helpers or business logic; just the schema and the `db` export.

### Modified Capabilities

_(none)_

## Impact

- Adds `dexie` to `extension/package.json` dependencies
- Replaces `extension/src/lib/storage/index.ts` stub
- All subsequent changes (`llm-client`, `ingestion-pipeline`, `session-manager`, etc.) import from `@/lib/storage`
- No UI changes

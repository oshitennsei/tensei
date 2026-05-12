## Context

The spec (§4) defines a large IndexedDB schema: 17 object stores covering works, chapters, scenes, chunks, entities, events, timelines, characters, sessions, personas, LLM configs, sub-agent cache, authorization cache, and the Phase 4 performance/BTS stores. Dexie.js is the chosen ORM (spec §29). The storage layer is pure schema — no query helpers, no business logic.

The key design challenge is TypeScript typing: IndexedDB stores untyped blobs, but the rest of the codebase needs strong types. Dexie v4 supports typed tables natively.

## Goals / Non-Goals

**Goals:**
- Define all 17 object stores as typed Dexie tables
- Declare all indexes from spec §4.3
- Export a single `db` singleton
- Schema versioned from v1 with an upgrade path pattern
- `Float32Array` embeddings stored directly (IndexedDB supports binary)

**Non-Goals:**
- Query helpers or repository pattern (each feature implements its own queries)
- Data validation / Zod schemas (not needed at storage boundary)
- Migration from any previous version (greenfield, v1 only)
- Performance/BTS stores are defined but empty — no logic uses them yet

## Decisions

### Dexie v4 with typed tables

Dexie v4 (`dexie@^4`) introduces first-class TypeScript generics: `db.table<MyType>()`. Each store gets a TS interface matching spec §4 fields. The `db` object is a class extending `Dexie`, with typed table properties.

### Single file for schema, split types to a separate file

`src/lib/storage/index.ts` — the `db` singleton and Dexie schema definition  
`src/lib/storage/types.ts` — all TypeScript interfaces for stored objects

This separation lets other modules import just the types without pulling in Dexie at import time.

### Embedding storage: `Float32Array` directly in IndexedDB

Spec §4.4 says embeddings are stored as `Float32Array`. IndexedDB natively supports `ArrayBuffer` and typed arrays — no serialization needed. Dexie stores them as-is.

### Version 1 only, migration hook in place

The schema starts at version 1. The Dexie `version(1).stores(...)` call establishes all stores. A `version(2)` stub with an `.upgrade()` no-op is NOT added — that's boilerplate clutter until we actually need to migrate. The versioning pattern (class method, not inline object) is documented in a comment so future changes know where to add migrations.

### IDs: strings (UUID v4) not auto-increment integers

Auto-increment keys are fine for simple apps but create merge conflicts when exporting/importing data across devices. All primary keys are `string` (UUID v4). The `crypto.randomUUID()` browser API generates them at write time — no library needed.

### `++id` Dexie syntax only where spec uses generated keys

Spec uses explicit UUIDs, so we use `&id` (primary key, not auto-increment) for all stores. No `++id` anywhere.

## Risks / Trade-offs

- **Large schema upfront**: Defining all 17 stores now (including Phase 4 BTS/performance) means more code before any of it is used. Trade-off accepted: changing the schema later requires a Dexie version bump and migration, which is more expensive than defining empty tables now.
- **No query layer**: Callers write raw Dexie queries. Risk of inconsistency. Mitigated by keeping queries close to the features that own them (ingestion owns ingestion queries, session manager owns session queries).
- **Embedding size**: A 300K-char novel generates ~3000 chunks × 1536 floats × 4 bytes = ~18 MB for embeddings alone. Well within IndexedDB limits but worth monitoring. No mitigation needed yet.

## Open Questions

- Icon/icon assets: not relevant to storage.
- Should `llm_configs.api_key` be encrypted with the Web Crypto API? The spec says "encrypted at rest by browser" and `chrome.storage.local` provides OS-level encryption. Since we're using IndexedDB (not `chrome.storage`), we should encrypt keys ourselves. Deferred to the `llm-client` change which owns that field.

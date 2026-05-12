## ADDED Requirements

### Requirement: Database initializes as a versioned Dexie instance
The system SHALL export a single `db` singleton of a class extending `Dexie`, initialized at version 1 with all object stores declared. The singleton SHALL be importable from `@/lib/storage` without side effects beyond opening the database connection.

#### Scenario: db import does not throw
- **WHEN** any module imports `{ db }` from `@/lib/storage`
- **THEN** no exception is thrown and `db` is a Dexie instance in a ready or opening state

#### Scenario: Database opens at correct version
- **WHEN** the extension loads for the first time
- **THEN** IndexedDB SHALL contain a database named `tensei` at schema version 1

---

### Requirement: Core content object stores exist with correct indexes
The database SHALL contain the following stores with the indexes specified:

| Store | Primary key | Indexes |
|-------|-------------|---------|
| `works` | `id` | — |
| `chapters` | `id` | `work_id`, `chapter_number` |
| `scenes` | `id` | `chapter_id` |
| `chunks` | `id` | `chapter_id`, `scene_id`, `[chapter_id+scene_id]` |
| `entities` | `id` | `type`, `work_id`, `*aliases` (multi-entry) |
| `events` | `id` | `chapter_id`, `scene_id`, `*participants` (multi-entry) |
| `timelines` | `id` | `work_id` |

#### Scenario: Chunk inserted and retrieved by chapter
- **WHEN** a chunk record is added with `chapter_id = "c1"`
- **THEN** `db.chunks.where("chapter_id").equals("c1").toArray()` SHALL return that record

#### Scenario: Entity retrieved by alias (multi-entry index)
- **WHEN** an entity with `aliases: ["Kael", "K"]` is stored
- **THEN** `db.entities.where("aliases").equals("Kael").first()` SHALL return that entity

---

### Requirement: Character and session stores exist with correct indexes
The database SHALL contain:

| Store | Primary key | Indexes |
|-------|-------------|---------|
| `characters_extended` | `id` | `work_id` |
| `sessions` | `id` | `[work_id+character_id]`, `last_active` |
| `personas` | `id` | `is_default` |
| `llm_configs` | `id` | `role` |
| `cache_subagent` | `cache_key` | `session_id`, `created_at` |
| `authorizations_local` | `work_identifier` | `status` |

#### Scenario: Session retrieved by work and character
- **WHEN** a session with `work_id = "w1"` and `character_id = "ch1"` is stored
- **THEN** `db.sessions.where("[work_id+character_id]").equals(["w1", "ch1"]).toArray()` SHALL return that session

#### Scenario: Sessions sorted by last_active
- **WHEN** multiple sessions exist with different `last_active` timestamps
- **THEN** `db.sessions.orderBy("last_active").reverse().toArray()` SHALL return them newest-first

---

### Requirement: Performance and BTS mode stores exist
The database SHALL contain the following stores (schema defined, no queries implemented yet):

| Store | Primary key |
|-------|-------------|
| `performance_templates` | `id` |
| `performer_skills` | `id` |
| `performance_sessions` | `id` |
| `performance_scenes_extended` | `id` |
| `bts_sessions` | `id` |
| `community_third_party_sources` | `source_url` |

#### Scenario: Performance template can be stored and retrieved
- **WHEN** a performance template object is added to `performance_templates`
- **THEN** `db.performance_templates.get(id)` SHALL return the stored object

---

### Requirement: TypeScript interfaces cover all stored object shapes
The module SHALL export TypeScript interfaces for every object store from `@/lib/storage/types`. All fields from spec §4.2 SHALL be represented. Optional fields SHALL use `?`. Embedding fields SHALL be typed as `Float32Array`.

#### Scenario: Chunk type has embedding field
- **WHEN** a developer writes `const c: Chunk = { ... }`
- **THEN** TypeScript SHALL enforce that `c.embedding` is `Float32Array | undefined`

#### Scenario: No untyped `any` in storage types
- **WHEN** the TypeScript compiler runs with `strict: true`
- **THEN** there SHALL be zero `any` types in `src/lib/storage/types.ts`

---

### Requirement: All primary keys are string UUIDs
Every object store SHALL use a string primary key. Auto-increment integer keys (`++id`) SHALL NOT be used. Callers are responsible for generating UUIDs via `crypto.randomUUID()` before inserting.

#### Scenario: Insert without id is rejected by TypeScript
- **WHEN** a developer calls `db.works.add({ title: "test" })` without an `id` field
- **THEN** TypeScript SHALL produce a compile-time error (field is required)

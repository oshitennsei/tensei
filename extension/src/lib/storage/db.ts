import Dexie, { type EntityTable } from "dexie";
import type {
  Work, Chapter, Scene, Chunk,
  Entity, Event, Timeline,
  CharacterExtended, EntityExtended, Session, Persona, LlmConfig,
  LlmModel, LlmRoleAssignments, AppSettings,
  CacheSubagent, AuthorizationLocal,
  PerformanceTemplate, PerformerSkill, PerformanceSession,
  PerformanceSceneExtended, BtsSession, CommunityThirdPartySource,
  WorkGlossary, ProductionPlan,
} from "./types";

class TenseiDb extends Dexie {
  works!: EntityTable<Work, "id">;
  chapters!: EntityTable<Chapter, "id">;
  scenes!: EntityTable<Scene, "id">;
  chunks!: EntityTable<Chunk, "id">;
  entities!: EntityTable<Entity, "id">;
  events!: EntityTable<Event, "id">;
  timelines!: EntityTable<Timeline, "id">;
  characters_extended!: EntityTable<CharacterExtended, "id">;
  entities_extended!: EntityTable<EntityExtended, "id">;
  sessions!: EntityTable<Session, "id">;
  personas!: EntityTable<Persona, "id">;
  llm_configs!: EntityTable<LlmConfig, "id">;
  llm_models!: EntityTable<LlmModel, "id">;
  llm_role_assignments!: EntityTable<LlmRoleAssignments, "id">;
  cache_subagent!: EntityTable<CacheSubagent, "cache_key">;
  authorizations_local!: EntityTable<AuthorizationLocal, "work_identifier">;
  performance_templates!: EntityTable<PerformanceTemplate, "id">;
  performer_skills!: EntityTable<PerformerSkill, "id">;
  performance_sessions!: EntityTable<PerformanceSession, "id">;
  performance_scenes_extended!: EntityTable<PerformanceSceneExtended, "id">;
  bts_sessions!: EntityTable<BtsSession, "id">;
  community_third_party_sources!: EntityTable<CommunityThirdPartySource, "source_url">;
  app_settings!: EntityTable<AppSettings, "id">;
  work_glossaries!: EntityTable<WorkGlossary, "id">;
  production_plans!: EntityTable<ProductionPlan, "id">;

  constructor() {
    super("tensei");

    // To add a new schema version:
    //   this.version(N).stores({ ...newStores }).upgrade(tx => { ... });
    this.version(1).stores({
      // Core content — §4.2
      works:               "&id",
      chapters:            "&id, work_id, chapter_number",
    });

    this.version(2).stores({
      // Core content — §4.2
      works:               "&id, title, author",
      chapters:            "&id, work_id, chapter_number, [work_id+chapter_number]",
      scenes:              "&id, chapter_id",
      chunks:              "&id, chapter_id, scene_id, [chapter_id+scene_id]",
      entities:            "&id, type, work_id, *aliases",
      events:              "&id, chapter_id, scene_id, *participants",
      timelines:           "&id, work_id",

      // Character and session data
      characters_extended: "&id, work_id",
      sessions:            "&id, [work_id+character_id], last_active",
      personas:            "&id, is_default",
      llm_configs:         "&id, role",
      cache_subagent:      "&cache_key, session_id, created_at",
      authorizations_local:"&work_identifier, status",

      // Performance / BTS (Phase 4 — schema defined now to avoid future migrations)
      performance_templates:        "&id",
      performer_skills:             "&id",
      performance_sessions:         "&id",
      performance_scenes_extended:  "&id",
      bts_sessions:                 "&id",
      community_third_party_sources:"&source_url",
    });

    this.version(3).stores({
      llm_models:            "&id",
      llm_role_assignments:  "&id",
    }).upgrade(async tx => {
      const configs: LlmConfig[] = await tx.table("llm_configs").toArray();
      if (configs.length === 0) return;

      const seenEndpointModel = new Map<string, string>(); // "url|model" → new model id
      const assignments: Partial<Record<string, string>> = {};

      for (const cfg of configs) {
        const key = `${cfg.endpoint_url}|${cfg.model_name}`;
        let model_id = seenEndpointModel.get(key);
        if (!model_id) {
          model_id = cfg.id;
          await tx.table("llm_models").add({
            id: model_id,
            name: cfg.name,
            endpoint_url: cfg.endpoint_url,
            api_key: cfg.api_key,
            model_name: cfg.model_name,
          } satisfies LlmModel);
          seenEndpointModel.set(key, model_id);
        }
        assignments[cfg.role] = model_id;
      }

      await tx.table("llm_role_assignments").put({
        id: "default",
        assignments,
      } satisfies LlmRoleAssignments);
    });

    this.version(4).stores({
      app_settings: "&id",
    });

    this.version(5).stores({ work_glossaries: "&id, work_id" });

    this.version(6).stores({
      production_plans: "&id, performance_session_id",
    });

    this.version(7).stores({
      events: "&id, work_id, chapter_id, scene_id, *participants, first_chapter",
    });

    this.version(8).stores({
      scripts: "&id, work_id, chapter_number, performance_session_id",
    });

    this.version(9).stores({});

    this.version(10).stores({});  // compression_in_progress added to Session (no new indexed stores)

    this.version(11).stores({});  // supplementary_material added to ProductionPlan (no new indexed stores)

    this.version(12).stores({});  // segmented_source_text added to ProductionPlan (no new indexed stores)

    this.version(13).stores({});  // portal_work_id on Work, author_summary on Chapter (Phase 6)

    this.version(14).stores({ works: "&id, title, author, platform_url" });  // index platform_url for portal linkage

    this.version(15).stores({ performance_sessions: "&id, work_id, last_active" });  // index work_id so WorkScreen query works

    this.version(16).stores({ bts_sessions: "&id, work_id, last_active" });  // index work_id for listBtsSessions query

    this.version(17).stores({});  // display_name, gender, birthday, height, birthplace, career_background added to PerformerSkill

    this.version(18).stores({});  // character_states added to BtsSession

    this.version(19).stores({});  // user_character_id added to PerformanceSession

    this.version(20).stores({});  // segment_type, speaker_name added to GeneratedSegment

    this.version(21).stores({
      entities_extended: "&id, work_id",
    });

    this.version(22).stores({});  // title added to Session and PerformanceSession
  }
}

export const db = new TenseiDb();

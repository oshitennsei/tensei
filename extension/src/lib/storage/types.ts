// ─── Shared primitives ───────────────────────────────────────────────────────

export type SourceType = "authorized" | "pasted";
export type Language = "ja" | "zh" | "zh-tw" | "zh-cn" | "en" | "ko" | "other";
export type Platform = "syosetu" | "kakuyomu" | "other";
export type SessionMode = "reader" | "author";
export type LlmRole = "main" | "sub_agent" | "embedding" | "compression";
export type AuthorizationStatus = "active" | "suspended" | "revoked";
export type EntityType = "character" | "item" | "location" | "concept" | "organization";
export type TimelineAxis = "chronological" | "narrative" | "character";
export type Canonicity = "re_enactment" | "extension" | "speculation" | "alternate";
export type SceneBasis = "chapter" | "post_story" | "spinoff" | "virtual";

// ─── Core content stores ─────────────────────────────────────────────────────

export interface Work {
  id: string;
  title: string;
  author: string;
  language: Language;
  platform: Platform;
  source_type: SourceType;
  authorization_record_url?: string;
  last_updated: number; // epoch ms
  background_image?: Blob;
  background_value?: string; // CSS background (color or gradient)
}

export interface AppSettings {
  id: string; // always "global"
  background_image?: Blob;
  background_value?: string; // CSS background (color or gradient), used when no image set
  plan_max_loops?: number;   // default 3; research rounds before forcing plan generation
  plan_debug_mode?: boolean; // default false; store full research trace in ProductionPlan
}

export interface Chapter {
  id: string;
  work_id: string;
  chapter_number: number;
  title: string;
  full_text: string;
  summary_ultra: string;   // ~50 chars
  summary_short: string;   // ~200 chars
  summary_medium: string;  // 500-800 chars
  appearing_characters: string[];   // entity ids
  mentioned_characters: string[];
  mentioned_items: string[];
  key_events: string[];             // event ids
  chunk_ids: string[];
  embedding_summary?: Float32Array;
}

export interface Scene {
  id: string;
  chapter_id: string;
  position: number;
  summary: string;
  characters: string[];  // entity ids
  events: string[];      // event ids
  items: string[];
}

export interface Chunk {
  id: string;
  chapter_id: string;
  scene_id?: string;
  position: number;
  text: string;
  embedding?: Float32Array;
  characters_present: string[];  // entity ids
  events: string[];
  items: string[];
  mood?: string;
  content_tags: string[];
}

// ─── Entity and event stores ─────────────────────────────────────────────────

export interface EntityAlias {
  text: string;
  chapter_range?: [number, number]; // [first_chapter, last_chapter]
}

export interface LinkedEntity {
  entity_id: string;
  relationship_type: string;
  strength: number; // 0-1
}

export interface Entity {
  id: string;
  work_id: string;
  type: EntityType;
  canonical_name: string;
  aliases: string[];         // flat for multi-entry index; alias objects in aliases_detail
  aliases_detail?: EntityAlias[];
  description: string;
  embedding?: Float32Array;
  parent_entities: string[];
  child_entities: string[];
  first_appearance?: number;    // chapter number
  key_appearances: number[];
  linked_entities: LinkedEntity[];
}

export interface EventParticipant {
  entity_id: string;
  role: string;
}

export interface Event {
  id: string;
  chapter_id: string;
  scene_id?: string;
  who: EventParticipant[];
  what: string;
  when?: string;
  where?: string;
  why?: string;
  how?: string;
  witnesses: string[];           // entity ids
  unaware_characters: string[];  // entity ids
  consequences: string[];
  related_events: string[];      // event ids
  embedding?: Float32Array;
  content_tags: string[];
  participants: string[];        // flat entity ids for multi-entry index
}

export interface Timeline {
  id: string;
  work_id: string;
  axis_type: TimelineAxis;
  events_in_order: string[]; // event ids
}

// ─── Character and session stores ────────────────────────────────────────────

export interface VoiceSample {
  context: string;
  line: string;
  chapter?: number;
}

export interface CharacterStateSnapshot {
  // Version identity
  id?: string;
  label?: string;                   // reader-facing: "少年時代", "成長後"
  character_age?: string;           // "7歳頃"
  from_chapter?: number | null;     // null = timeline-independent (flashback)
  is_selectable?: boolean;          // show in reader version picker
  // Persona overrides (null/undefined = use base CharacterExtended values)
  persona_override?: string;
  speech_style_override?: string;
  change_reason?: string;           // author note
  // Existing fields
  at_chapter: number;
  knowledge: string[];
  emotional_state: string;
  relationships: Record<string, string>;
}

export type LockedField = "persona" | "speech_style" | "will_not_do" | "forbidden_topics";

export interface CharacterExtended {
  id: string;
  work_id: string;
  persona: string;
  speech_style?: string;
  voice_samples: VoiceSample[];
  will_do: string[];
  will_not_do: string[];
  forbidden_topics: string[];
  dialogue_examples?: Array<{
    context: string;
    user_message_pattern: string;
    ideal_response: string;
    notes?: string;
  }>;
  state_snapshots: CharacterStateSnapshot[];
  locked_fields?: LockedField[];    // fields author has marked non-overridable
  author_provided: boolean;
  author_authorization_id?: string;
}

export interface Turn {
  role: "user" | "character";
  content: string;
  timestamp: number;
}

export interface Tier1Summary {
  turns: [number, number]; // [start_turn, end_turn]
  topic: string;
  key_exchanges: string[];
  emotional_state_change: { before: string; after: string };
  new_facts_established: string[];
}

export interface Tier2Summary {
  tier1_segments: [number, number][]; // ranges covered
  arc_summary: string;
  major_facts: string[];
}

export interface EstablishedFact {
  fact: string;
  turn: number;
  topic_tags: string[];
}

export interface Session {
  id: string;
  work_id: string;
  character_id: string;
  mode: SessionMode;
  cutoff_chapter: number;
  started_at: number;
  last_active: number;
  tier_0_recent_turns: Turn[];
  tier_1_paragraph_summaries: Tier1Summary[];
  tier_2_chapter_summaries: Tier2Summary[];
  session_summary: string;
  established_facts: EstablishedFact[];
  emotional_arc: string;
  session_events: string[];  // event ids
  reader_profile_in_session: string;
  character_version_id?: string; // CharacterStateSnapshot.id or "base"
}

export interface Persona {
  id: string;
  name: string;
  language: Language;              // reader's preferred response language
  content_md: string;
  applies_to: string[];            // work id patterns; "*" = all works
  is_default: boolean;
}

export interface GlossaryEntry {
  original: string;
  translations: Partial<Record<Language, string>>;
  notes?: string;
}

export interface WorkGlossary {
  id: string;  // same as work_id, singleton per work
  work_id: string;
  entries: GlossaryEntry[];
}

// Also stored in Session to track which version of a character is being used
export interface SessionCharacterVersion {
  session_id: string;
  character_version_id: string;   // CharacterStateSnapshot.id, or "base"
}

/** @deprecated Use LlmModel + LlmRoleAssignments instead */
export interface LlmConfig {
  id: string;
  name: string;
  endpoint_url: string;
  api_key: string;
  model_name: string;
  role: LlmRole;
}

export interface LlmModel {
  id: string;
  name: string;
  endpoint_url: string;
  api_key: string;
  model_name: string;
  context_window?: number;  // tokens; used for multi-pass analysis chunk sizing
}

export interface LlmRoleAssignments {
  id: string;               // always "default" (singleton)
  assignments: Partial<Record<LlmRole, string>>;  // role → LlmModel.id
}

export interface CacheSubagent {
  cache_key: string; // hash(query + character_id + cutoff_chapter)
  result: string;
  created_at: number;
  session_id: string;
}

export interface AuthorizationLocal {
  work_identifier: string;
  full_authorization_record: Record<string, unknown>;
  last_synced_at: number;
  status: AuthorizationStatus;
}

// ─── Performance / BTS stores ─────────────────────────────────────────────────

export type TemplateSource = "official" | "community" | "third_party" | "local";
export type SkillSource = TemplateSource | "author_provided" | "ai_generated";
export type ValidationStatus = "ok" | "warned" | "pending";
export type PerformanceMode = "director" | "screenwriter" | "cast" | "hybrid";
export type ImprovSetting = "strict" | "moderate" | "free";
export type BtsLocation = "rest_area" | "makeup_room" | "set" | "cafeteria";

export interface FewShotExample {
  input: string;
  output: string;
}

export interface TemplateStyleParameters {
  pacing?: string;
  description_density?: string;
  dialogue_to_action_ratio?: string;
  meta_breaks?: string;
}

export interface PerformanceTemplate {
  id: string;
  source: TemplateSource;
  name: string;
  display_name_localized: Record<string, string>;
  cultural_context: string;
  suitable_for: string[];
  not_suitable_for: string[];
  format_conventions: string[];
  prompt_template: string;
  few_shot_examples: FewShotExample[];
  style_parameters: TemplateStyleParameters;
  default_scene_length: "short" | "medium" | "long";
  allow_improvisation: boolean;
  loaded_at: number;
  source_url?: string;
}

export interface OffSetPersona {
  casual_style: string;
  quirks: string[];
  interests: string[];
  relationships_with_others: Record<string, string>;
}

export interface SignatureStyle {
  acting_method: string;
  strengths: string[];
  notable_techniques: string[];
}

export interface PerformerSkill {
  id: string;
  source: SkillSource;
  name: string;
  background_type: "fictional";
  archetype: string;
  age_range?: string;
  personality_traits: string[];
  speech_patterns: string[];
  off_set_persona: OffSetPersona;
  signature_style: SignatureStyle;
  contrast_with_role_hints: string;
  off_set_interests: string[];
  loaded_at: number;
  source_url?: string;
  validation_status: ValidationStatus;
}

export interface GeneratedSegment {
  segment_id: string;
  type: "scene" | "beat";
  canonicity: Canonicity;
  source_basis: Record<string, unknown>;
  contains_new_dialogue: boolean;
  contains_new_actions: boolean;
  user_directed: boolean;
  content: string;
}

export interface PerformanceSession {
  id: string;
  work_id: string;
  mode: PerformanceMode;
  template_id: string;
  performer_skill_assignments: Record<string, string>; // character_id → skill_id
  characters_in_scene: string[];
  scene_progress: number;
  improvisation_setting: ImprovSetting;
  cutoff_chapter: number | "unlocked";
  generated_content: GeneratedSegment[];
  created_at: number;
  last_active: number;
  production_plan_id?: string;
}

export interface SceneBlocking {
  character_id: string;
  position?: string;
  movement?: string;
}

export interface PerformanceSceneExtended {
  id: string;
  scene_id: string;
  setting: {
    location: string;
    time_of_day?: string;
    atmosphere?: string;
    environment?: string;
  };
  blocking: SceneBlocking[];
  beats: string[];
  emotional_arc: string;
  key_dialogue: string[];
  tone_tags: string[];
  suggested_templates: string[];
}

export interface BtsTurn {
  speaker_skill_id: string;
  content: string;
  timestamp: number;
}

export interface BtsCrewMember {
  role: string;
  name: string;
  persona_snippet: string;
}

export interface BtsSession {
  id: string;
  work_id: string;
  present_performers: string[];  // skill ids
  present_crew: BtsCrewMember[];
  location: BtsLocation;
  conversation_history: BtsTurn[];
  created_at: number;
  last_active: number;
}

export interface CommunityThirdPartySource {
  source_url: string;
  source_type: "template" | "skill";
  loaded_at: number;
  last_used: number;
  user_acknowledged_warning: boolean;
}

export interface SceneBeat {
  order: number;
  description: string;
}

export interface ResearchTask {
  type: "search_passages" | "get_character_profile" | "get_chapter_detail" | "find_co_appearances" | "search_events";
  label: string;
  result_count: number;
  result_preview: string; // first 300 chars of combined results
}

export interface ResearchRound {
  round: number;
  llm_plan: string;       // main LLM's research plan reasoning
  tasks: ResearchTask[];
  llm_evaluation: string; // evaluation reasoning
  sufficient: boolean;
}

export interface ProductionPlan {
  id: string;
  performance_session_id: string;
  created_at: number;
  // 5W1H
  who: string[];           // character canonical names
  where: string;
  when: string;
  what: string;
  why: string;
  how: string;
  // Extended
  props: string[];
  tone_tags: string[];
  beats: SceneBeat[];
  scene_basis: SceneBasis;
  reference_chapter?: number;
  canonicity: Canonicity;
  user_notes?: string;
  locked_plan_fields?: Array<"who" | "where" | "when" | "what" | "why" | "how" | "props" | "tone_tags" | "beats">;
  debug_trace?: ResearchRound[]; // only present when plan_debug_mode is enabled
}

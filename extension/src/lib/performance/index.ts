import { LlmClient, LlmError } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { PerformanceSession, PerformanceMode, ImprovSetting, GeneratedSegment, Chapter, ResearchRound, ResearchTask } from "@/lib/storage";
import type { ProductionPlan, SceneBasis } from "@/lib/storage";
import { retrieveChunks } from "@/lib/retrieval";
import { getEmbedder } from "@/lib/embedding";
import { getStrings, langFromStorage } from "@/lib/i18n";
import type { Strings } from "@/lib/i18n";

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  const d = Math.sqrt(normA) * Math.sqrt(normB);
  return d > 0 ? dot / d : 0;
}

function toFloat32(v: unknown): Float32Array | undefined {
  if (!v) return undefined;
  if (v instanceof Float32Array) return v;
  if (v instanceof ArrayBuffer) return new Float32Array(v);
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return new Float32Array(v as number[]);
  return undefined;
}

// ─── Research loop types ──────────────────────────────────────────────────────

interface TaskSpec {
  type: "search_passages" | "get_character_profile" | "get_chapter_detail" | "get_chapter_full_text" | "find_co_appearances" | "search_events";
  query?: string;
  character_id?: string;
  chapter_number?: number;
  character_ids?: string[];
}

interface TaskResult {
  label: string;
  content: string;
  count: number;
  chunk_ids?: string[];
}

export type PlanProgressEvent =
  | { type: "planning"; round: number }
  | { type: "fetching"; round: number; tasks: string[] }
  | { type: "evaluating"; round: number }
  | { type: "writing" }
  | { type: "segmenting" }
  | { type: "done"; plan: ProductionPlan; session: PerformanceSession };

export type SceneChunk =
  | { type: "stream"; delta: string }
  | { type: "progress"; step: "generating" | "evaluating" | "retrying" }
  | { type: "done"; content: string };

// ─── Task execution ───────────────────────────────────────────────────────────

async function executeTask(spec: TaskSpec, work_id: string, cutoff: number, s: Strings, anchor_chapter?: number): Promise<TaskResult> {
  try {
    switch (spec.type) {
      case "search_passages": {
        const results = await retrieveChunks(work_id, spec.query ?? "", cutoff, 5, spec.character_id, anchor_chapter);
        const texts = results.map(r => r.chunk.text);
        return { label: s.tl_search(spec.query ?? ""), content: texts.join("\n---\n"), count: texts.length, chunk_ids: results.map(r => r.chunk.id) };
      }
      case "get_character_profile": {
        const [entity, ext] = await Promise.all([
          db.entities.get(spec.character_id ?? ""),
          db.characters_extended.get(spec.character_id ?? ""),
        ]);
        if (!entity) return { label: s.tl_char_fetch, content: "", count: 0 };
        const lines = [
          `【${entity.canonical_name}】`,
          entity.description,
          ext?.persona ? `${s.persona_prefix}${ext.persona}` : "",
          ext?.speech_style ? `${s.speech_prefix}${ext.speech_style}` : "",
        ].filter(Boolean);
        return { label: s.tl_profile(entity.canonical_name), content: lines.join("\n"), count: 1 };
      }
      case "get_chapter_detail": {
        const chapter = await db.chapters
          .where("work_id").equals(work_id)
          .filter(c => c.chapter_number === (spec.chapter_number ?? 0))
          .first();
        if (!chapter) return { label: s.tl_chapter(spec.chapter_number ?? 0), content: "", count: 0 };
        const lines = [
          s.chapter_label(chapter.chapter_number, chapter.title),
          chapter.summary_medium || chapter.summary_short,
          chapter.key_events.length > 0
            ? s.chapter_events_prefix + chapter.key_events.slice(0, 8).map(e => `・${e}`).join("\n")
            : "",
        ].filter(Boolean);
        return { label: s.tl_chapter_detail(chapter.chapter_number, chapter.title), content: lines.join("\n"), count: 1 };
      }
      case "get_chapter_full_text": {
        const chapter = await db.chapters
          .where("work_id").equals(work_id)
          .filter(c => c.chapter_number === (spec.chapter_number ?? 0))
          .first();
        if (!chapter) return { label: s.tl_chapter_full_text(spec.chapter_number ?? 0), content: "", count: 0 };
        return {
          label: s.tl_chapter_full_text(chapter.chapter_number),
          content: `【第${chapter.chapter_number}章「${chapter.title}」原文】\n${chapter.full_text}`,
          count: 1,
          chunk_ids: chapter.chunk_ids,
        };
      }
      case "find_co_appearances": {
        const ids = spec.character_ids ?? [];
        const allChapters = await db.chapters.where("work_id").equals(work_id)
          .filter(c => {
            if (c.chapter_number > cutoff) return false;
            if (anchor_chapter != null) return Math.abs(c.chapter_number - anchor_chapter) <= 3;
            return true;
          })
          .toArray();
        const chapIds = allChapters.map(c => c.id);
        const chunks = chapIds.length > 0
          ? await db.chunks.where("chapter_id").anyOf(chapIds)
              .filter(c => ids.every(id => c.characters_present.includes(id)))
              .toArray()
          : [];
        const top = chunks.slice(0, 5).map(c => c.text);
        return { label: s.tl_co_count(ids.length), content: top.join("\n---\n"), count: top.length };
      }
      case "search_events": {
        const query = (spec.query ?? "").toLowerCase();
        const terms = query.split(/\s+/).filter(t => t.length > 0);
        // Search the events table first (richer: what + occurrence notes)
        const allEvents = await db.events.where("work_id").equals(work_id)
          .filter(e => e.first_chapter <= cutoff)
          .toArray();
        const eventHits = allEvents
          .filter(e => terms.some(t =>
            e.what.toLowerCase().includes(t) ||
            e.occurrences.some(o => o.note.toLowerCase().includes(t))
          ))
          .slice(0, 8)
          .map(e => {
            const bestOcc = e.occurrences.find(o => terms.some(t => o.note.toLowerCase().includes(t))) ?? e.occurrences[0];
            return `第${e.first_chapter}章: ${e.what}${bestOcc?.note ? `\n  └ ${bestOcc.note}` : ""}`;
          });
        if (eventHits.length > 0) {
          return { label: s.tl_events(spec.query ?? ""), content: eventHits.join("\n"), count: eventHits.length };
        }
        // Fallback to key_events tags
        const chapters = await db.chapters.where("work_id").equals(work_id)
          .filter(c => c.chapter_number <= cutoff).toArray();
        const keyHits = chapters
          .flatMap(c => c.key_events.map(e => ({ ch: c.chapter_number, e })))
          .filter(({ e }) => terms.some(t => e.toLowerCase().includes(t)))
          .slice(0, 10)
          .map(({ ch, e }) => `第${ch}章: ${e}`);
        return { label: s.tl_events(spec.query ?? ""), content: keyHits.join("\n"), count: keyHits.length };
      }
    }
  } catch {
    return { label: spec.type, content: "", count: 0 };
  }
}

function parseTaskSpecs(raw: string): { reasoning: string; tasks: TaskSpec[] } {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { reasoning?: string; tasks?: unknown[] };
    const validTypes = new Set(["search_passages", "get_character_profile", "get_chapter_detail", "get_chapter_full_text", "find_co_appearances", "search_events"]);
    const tasks = (parsed.tasks ?? []).filter((t): t is TaskSpec => {
      if (!t || typeof t !== "object") return false;
      return validTypes.has((t as { type?: string }).type ?? "");
    });
    return { reasoning: String(parsed.reasoning ?? ""), tasks };
  } catch {
    return { reasoning: "", tasks: [] };
  }
}

function parseSufficiencyJudgment(raw: string): { reasoning: string; sufficient: boolean; additional_tasks: TaskSpec[] } {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { reasoning?: string; sufficient?: boolean; additional_tasks?: unknown[] };
    const validTypes = new Set(["search_passages", "get_character_profile", "get_chapter_detail", "get_chapter_full_text", "find_co_appearances", "search_events"]);
    const additional_tasks = (parsed.additional_tasks ?? []).filter((t): t is TaskSpec => {
      if (!t || typeof t !== "object") return false;
      return validTypes.has((t as { type?: string }).type ?? "");
    });
    return {
      reasoning: String(parsed.reasoning ?? ""),
      sufficient: Boolean(parsed.sufficient),
      additional_tasks,
    };
  } catch {
    return { reasoning: "", sufficient: true, additional_tasks: [] };
  }
}

export async function createPerformanceSession(
  work_id: string,
  character_ids: string[],
  mode: PerformanceMode,
  cutoff_chapter: number,
  improv: ImprovSetting,
  user_character_id?: string,
): Promise<PerformanceSession> {
  const session: PerformanceSession = {
    id: crypto.randomUUID(),
    work_id,
    mode,
    template_id: "default",
    performer_skill_assignments: {},
    characters_in_scene: character_ids,
    user_character_id,
    scene_progress: 0,
    improvisation_setting: improv,
    cutoff_chapter,
    generated_content: [],
    created_at: Date.now(),
    last_active: Date.now(),
  };
  await db.performance_sessions.add(session);
  return session;
}

// ─── Compression helper ───────────────────────────────────────────────────────

function materialBudget(client: LlmClient): number {
  // 50% of context window at ~3 chars/token (conservative for CJK); default 50K chars
  const ctx = client.config.context_window;
  return ctx ? Math.floor(ctx * 0.5 * 3) : 50000;
}

async function compressIfNeeded(material: string, client: LlmClient, budget: number): Promise<string> {
  if (material.length <= budget) return material;
  const compressionClient = await LlmClient.forRole("compression") ?? client;
  const targetChars = Math.floor(budget * 0.85);
  try {
    return await compressionClient.complete([{
      role: "user",
      content:
        `以下の調査資料を${targetChars}文字以内にまとめてください。` +
        `重要な事実・人物情報・場面の詳細・セリフを優先して保持し、冗長な部分を削除してください。\n\n` +
        material,
    }]);
  } catch {
    return material.slice(0, budget);
  }
}

// ─── Chapter segmentation ─────────────────────────────────────────────────────

interface SegmentationResult {
  beats: Array<{ n: number; title: string }>;
  segmented_text: string;
}

async function segmentChapterText(
  full_text: string,
  client: LlmClient,
  s: Strings,
): Promise<SegmentationResult> {
  // Split at blank lines → group into ~400 char segments, labeled [_P0_]..[_PN_]
  const paras = full_text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const segments: string[] = [];
  let current: string[] = [];
  let curLen = 0;
  const TARGET = 400;
  for (const p of paras) {
    if (current.length > 0 && curLen + p.length > TARGET) {
      segments.push(current.join("\n\n"));
      current = [p]; curLen = p.length;
    } else {
      current.push(p); curLen += p.length;
    }
  }
  if (current.length > 0) segments.push(current.join("\n\n"));

  if (segments.length === 0) return { beats: [], segmented_text: full_text };

  const lastP = segments.length - 1;
  const labeled = segments.map((seg, i) => `[_P${i}_]\n${seg}`).join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: s.seg_system(lastP) },
    { role: "user", content: `${s.seg_user}\n\n${labeled}` },
  ];

  let rawBeats: Array<{ n: number; title: string; start_p: number }> = [];
  try {
    const raw = await client.complete(messages);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { beats?: unknown[] };
    rawBeats = (parsed.beats ?? []).filter((b): b is { n: number; title: string; start_p: number } => {
      if (!b || typeof b !== "object") return false;
      const bObj = b as Record<string, unknown>;
      return typeof bObj.n === "number" && typeof bObj.start_p === "number" &&
        bObj.start_p >= 0 && bObj.start_p <= lastP;
    });
  } catch {
    return { beats: [], segmented_text: full_text };
  }

  if (rawBeats.length === 0) return { beats: [], segmented_text: full_text };

  // Sort by start_p and re-number sequentially
  rawBeats.sort((a, b) => a.start_p - b.start_p);
  const numberedBeats = rawBeats.map((b, i) => ({ n: i + 1, title: b.title, start_p: b.start_p }));

  // Build segment-to-beat map, insert <<<BEAT N: title>>> markers
  const pToBeat = new Map(numberedBeats.map(b => [b.start_p, b]));
  const annotatedParts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const beat = pToBeat.get(i);
    annotatedParts.push(beat ? `<<<BEAT ${beat.n}: ${beat.title}>>>\n${segments[i]}` : segments[i]);
  }

  return {
    beats: numberedBeats.map(b => ({ n: b.n, title: b.title })),
    segmented_text: annotatedParts.join("\n\n"),
  };
}

// ─── Performance log download ─────────────────────────────────────────────────

export async function downloadPerformanceLog(session: PerformanceSession): Promise<void> {
  const [plan, rawEntities, work] = await Promise.all([
    getPlanForSession(session.id),
    db.entities.bulkGet(session.characters_in_scene),
    db.works.get(session.work_id),
  ]);

  const log = {
    format: "tensei-perf-debug-v1",
    exported_at: new Date().toISOString(),
    work: { id: session.work_id, title: work?.title ?? session.work_id },
    session: {
      id: session.id,
      mode: session.mode,
      cutoff_chapter: session.cutoff_chapter,
      improvisation_setting: session.improvisation_setting,
      scene_progress: session.scene_progress,
      created_at: new Date(session.created_at).toISOString(),
      characters: rawEntities.filter(Boolean).map(e => ({ id: e!.id, name: e!.canonical_name })),
    },
    plan: plan ? {
      id: plan.id,
      scene_basis: plan.scene_basis,
      reference_chapter: plan.reference_chapter,
      who: plan.who, where: plan.where, when: plan.when,
      what: plan.what, why: plan.why, how: plan.how,
      props: plan.props, tone_tags: plan.tone_tags,
      beats: plan.beats, canonicity: plan.canonicity,
      source_chunks_count: plan.source_chunk_ids?.length ?? 0,
      debug_trace: plan.debug_trace ?? [],
    } : null,
    segments: session.generated_content.map((seg, i) => ({
      beat: i + 1,
      id: seg.segment_id,
      content: seg.content,
      system_prompt: seg.debug_prompt ?? null,
    })),
  };

  const json = JSON.stringify(log, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tensei-debug-${new Date().toISOString().slice(0, 10)}-${session.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface SceneEvalResult {
  ok: boolean;
  reason: string;
  correction_hint: string;
}

async function evaluateScene(
  content: string,
  beatN: number,
  beatTitle: string,
  nextBeat: { n: number; title: string } | null,
  chars: string,
  s: Strings,
): Promise<SceneEvalResult> {
  const evalClient = await LlmClient.forRole("main");
  if (!evalClient) return { ok: true, reason: "", correction_hint: "" };
  try {
    const raw = await evalClient.complete([
      { role: "system", content: s.scene_eval_system(beatN, beatTitle, nextBeat?.title ?? null, chars) },
      { role: "user", content: content },
    ]);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { ok?: boolean; reason?: string; correction_hint?: string };
    return {
      ok: Boolean(parsed.ok),
      reason: String(parsed.reason ?? ""),
      correction_hint: String(parsed.correction_hint ?? ""),
    };
  } catch {
    return { ok: true, reason: "", correction_hint: "" };
  }
}

export async function* generateNextScene(
  session: PerformanceSession,
  direction: string,
  signal?: AbortSignal,
  plan?: ProductionPlan,
  onDebugPrompt?: (prompt: string) => void,
): AsyncGenerator<SceneChunk> {
  // 1. Load work, entities, charExts, and settings (for i18n language)
  const [work, entities, charExts, appSettings] = await Promise.all([
    db.works.get(session.work_id),
    db.entities.bulkGet(session.characters_in_scene),
    db.characters_extended.bulkGet(session.characters_in_scene),
    db.app_settings.get("global"),
  ]);
  const s = getStrings(langFromStorage(appSettings?.ui_language));

  // 2. Build system prompt
  const workTitle = work?.title ?? session.work_id;
  const systemParts: string[] = [];

  systemParts.push(`${s.work_label}: ${workTitle}`);

  // Persist scene_directive: save initial direction on beat 0, inject for all beats
  // In chapter beat-marker mode the beat markers define what to perform; the original
  // scene_directive (whole-chapter brief) conflicts with individual beat content, so suppress it.
  const effectiveDirective = session.scene_directive ?? (session.scene_progress === 0 ? direction.trim() : "");
  const isChapterBeatMode = plan?.scene_basis === "chapter" && !!plan?.segmented_source_text;
  if (!isChapterBeatMode && effectiveDirective) {
    systemParts.push(`${s.directive_label}\n${effectiveDirective}`);
  }

  // Characters block
  const characterLines: string[] = [];
  for (let i = 0; i < session.characters_in_scene.length; i++) {
    const entity = entities[i];
    const charExt = charExts[i];
    if (!entity) continue;
    let line = `${entity.canonical_name}: ${entity.description}`;
    if (charExt?.speech_style) {
      line += `（${s.speech_prefix}${charExt.speech_style}）`;
    }
    characterLines.push(line);
  }
  if (characterLines.length > 0) {
    systemParts.push(characterLines.join("\n"));
  }

  // Mode instruction
  const userCharEntity = session.user_character_id
    ? entities.find(e => e?.id === session.user_character_id)
    : entities[0];
  const userCharacterName = userCharEntity?.canonical_name ?? entities[0]?.canonical_name ?? "キャラクター";
  switch (session.mode) {
    case "director":     systemParts.push(s.mode_director); break;
    case "screenwriter": systemParts.push(s.mode_screenwriter); break;
    case "cast":         systemParts.push(s.mode_cast(userCharacterName)); break;
    case "hybrid":       systemParts.push(s.mode_hybrid); break;
  }

  // Improv setting
  switch (session.improvisation_setting) {
    case "strict":   systemParts.push(s.improv_strict); break;
    case "moderate": systemParts.push(s.improv_moderate); break;
    case "free":     systemParts.push(s.improv_free); break;
  }

  // Inject production plan and source material
  if (plan) {
    const beatIndex = session.scene_progress;

    if (isChapterBeatMode) {
      // Chapter beat-marker mode: the source text IS the content guide.
      // Injecting 5W (what/where/when/why) and supplementary_material causes the LLM to perform
      // the chapter climax in every beat instead of following the beat markers.
      // Only inject: tone, props, and directorial style (how).
      const planLines = [s.plan_header];
      if (plan.tone_tags.length > 0) planLines.push(`${s.plan_tone}${plan.tone_tags.join('、')}`);
      if (plan.props.length > 0) planLines.push(`${s.plan_props_line}${plan.props.join('、')}`);
      if (plan.how) planLines.push(`${s.plan_how}${plan.how}`);
      systemParts.push(planLines.join("\n"));
    } else {
      // Non-chapter or old chunk-based chapter: inject full 5W plan
      const planLines = [
        s.plan_header,
        `${s.plan_loc}${plan.where}`,
        `${s.plan_time}${plan.when}`,
        `${s.plan_summary}${plan.what}`,
        `${s.plan_background}${plan.why}`,
        `${s.plan_tone}${plan.tone_tags.join('、')}`,
      ];
      if (plan.props.length > 0) planLines.push(`${s.plan_props_line}${plan.props.join('、')}`);
      if (plan.scene_basis !== "chapter" && plan.beats.length > 0) {
        const currentBeat = plan.beats[beatIndex] ?? plan.beats[plan.beats.length - 1];
        if (currentBeat) planLines.push(s.plan_beat(beatIndex, plan.beats.length, currentBeat.description));
      }
      systemParts.push(planLines.join("\n"));

      // Chapter (old chunk-based): supplementary context
      if (plan.scene_basis === "chapter" && plan.supplementary_material) {
        systemParts.push(`${s.supplementary_label}\n${plan.supplementary_material}`);
      }
    }

    // Source text injection
    if (plan.scene_basis === "chapter" && plan.segmented_source_text) {
      // Beat-marker approach: feed the full annotated chapter; instruct LLM to perform beat N
      const beatN = plan.beats.length > 0
        ? Math.min(session.scene_progress + 1, plan.beats.length)
        : session.scene_progress + 1;
      const nextN = (plan.beats.length > 0 && beatN < plan.beats.length) ? beatN + 1 : null;
      systemParts.push(
        `${s.source_label_chapter(beatN)}\n${s.source_instruction_chapter(beatN, nextN)}\n${plan.segmented_source_text}`
      );
    } else {
      // Fallback: chunk-based approach (backward compat or non-chapter)
      const entityNames = entities.filter(Boolean).map(e => e!.canonical_name);
      const searchQuery = [plan.what, ...entityNames].filter(Boolean).join(" ");
      const passages: string[] = [];

      if (plan.reference_chapter != null) {
        if (plan.source_chunk_ids && plan.source_chunk_ids.length > 0) {
          const chunksById = await db.chunks.bulkGet(plan.source_chunk_ids);
          passages.push(...chunksById
            .filter((c): c is NonNullable<typeof c> => c != null)
            .sort((a, b) => a.position - b.position)
            .map(c => c.text));
        } else {
          const refCh = await db.chapters
            .where("work_id").equals(session.work_id)
            .filter(c => c.chapter_number === plan.reference_chapter)
            .first();
          if (refCh) {
            const allChunks = await db.chunks.where("chapter_id").equals(refCh.id).sortBy("position");
            for (const chunk of allChunks) passages.push(chunk.text);
          }
        }
      }

      if (passages.length === 0) {
        const generalResults = await retrieveChunks(session.work_id, searchQuery, session.cutoff_chapter, 5);
        for (const r of generalResults) passages.push(r.chunk.text);
      }

      if (passages.length > 0) {
        if (plan.scene_basis === "chapter") {
          // Old chunk-based window for plans without segmented_source_text
          const segmentsDone = session.generated_content.length;
          const chunksPerSegment = Math.max(2, Math.ceil(passages.length / 8));
          const lookback = segmentsDone > 0 ? Math.min(2, chunksPerSegment) : 0;
          const windowSize = Math.min(passages.length, chunksPerSegment + lookback + 2);
          const rawStart = segmentsDone * chunksPerSegment - lookback;
          const sliceStart = Math.max(0, Math.min(rawStart, passages.length - windowSize));
          const passageSlice = passages.slice(sliceStart, sliceStart + windowSize);
          const beatN = session.scene_progress + 1;
          systemParts.push(
            `${s.source_label}\n${s.source_instruction_chapter(beatN, null)}\n` +
            passageSlice.map(t => `---\n${t}`).join("\n")
          );
        } else {
          // Non-chapter scenes: sliding window per beat
          const totalBeats = plan.beats.length;
          const windowSize = Math.min(14, Math.max(4, Math.ceil(passages.length / Math.max(totalBeats, 1)) + 2));
          let passageSlice: string[];
          if (passages.length <= windowSize) {
            passageSlice = passages;
          } else {
            const beatFraction = totalBeats > 1 ? beatIndex / (totalBeats - 1) : 0;
            const sliceStart = Math.floor(beatFraction * (passages.length - windowSize));
            passageSlice = passages.slice(sliceStart, sliceStart + windowSize);
          }
          systemParts.push(
            `${s.source_label}\n${s.source_instruction}\n` +
            passageSlice.map(t => `---\n${t}`).join("\n")
          );
        }
      }
    }
  }

  systemParts.push(s.output_rules);

  const systemPromptText = systemParts.join("\n\n");

  // Emit debug prompt snapshot if debug mode is on
  if (appSettings?.plan_debug_mode && onDebugPrompt) {
    onDebugPrompt(systemPromptText);
  }

  const systemMessage: ChatMessage = {
    role: "system",
    content: systemPromptText,
  };

  const messages: ChatMessage[] = [systemMessage];

  // Build message history using compression-aware context
  const compressedThrough = session.compressed_through_index ?? -1;

  if (session.compressed_context) {
    // Include compressed summary of older history
    messages.push({ role: "assistant", content: `${s.compression_context_label}\n${session.compressed_context}` });
    messages.push({ role: "user", content: s.continue_prompt });
  }

  // Include uncompressed recent segments (after compression cutoff)
  const recentSegments = session.generated_content.slice(compressedThrough + 1);
  if (recentSegments.length > 0) {
    const recentContext = recentSegments.map(seg => seg.content).join("\n\n---\n\n");
    messages.push({ role: "assistant", content: recentContext });
  }

  // User message — extract crew annotations from direction and convert to stage notes
  const crewNotePattern = /【([^】]+)】/g;
  const crewNotes: string[] = [];
  const cleanDirection = direction.replace(crewNotePattern, (_, inner) => {
    crewNotes.push(inner);
    return "";
  }).trim();

  let userContent = cleanDirection || s.continue_prompt;
  if (crewNotes.length > 0) {
    userContent = `${s.crew_note(crewNotes.join(" / "))}\n${userContent}`;
  }
  messages.push({ role: "user", content: userContent });

  // Get LLM client (scene → main fallback; future: character-specific override on top)
  let client = await LlmClient.forRole("scene");
  if (!client) client = await LlmClient.forRole("main");
  if (!client) {
    throw new LlmError(0, "LLMが設定されていません。");
  }

  const totalBeats = plan?.beats.length;
  const qualityCheck = (appSettings?.scene_quality_check !== false) && isChapterBeatMode;

  let finalContent = "";
  try {
    if (qualityCheck) {
      // Quality-check path: collect full output, evaluate, optionally retry
      yield { type: "progress", step: "generating" };
      finalContent = await client.complete(messages, signal);

      const beatN = plan!.beats.length > 0
        ? Math.min(session.scene_progress + 1, plan!.beats.length)
        : session.scene_progress + 1;
      const currentBeatMeta = plan!.beats.find(b => b.order === beatN);
      const nextBeatMeta = plan!.beats.find(b => b.order === beatN + 1) ?? null;
      const charNames = entities.filter(Boolean).map(e => e!.canonical_name).join("、");

      yield { type: "progress", step: "evaluating" };
      const evalResult = await evaluateScene(
        finalContent, beatN,
        currentBeatMeta?.description ?? `BEAT ${beatN}`,
        nextBeatMeta ? { n: nextBeatMeta.order, title: nextBeatMeta.description } : null,
        charNames, s,
      );

      if (!evalResult.ok && evalResult.correction_hint) {
        yield { type: "progress", step: "retrying" };
        const correctionMessages: ChatMessage[] = [
          ...messages,
          { role: "assistant", content: finalContent },
          { role: "user", content: s.scene_eval_correction(beatN, evalResult.reason, evalResult.correction_hint) },
        ];
        finalContent = await client.complete(correctionMessages, signal);
      }

      yield { type: "done", content: finalContent };
    } else {
      // Streaming path (non-chapter mode or quality check disabled)
      for await (const chunk of client.stream(messages, signal)) {
        if (chunk.delta) {
          finalContent += chunk.delta;
          yield { type: "stream", delta: chunk.delta };
        }
      }
      yield { type: "done", content: finalContent };
    }
  } finally {
    const updates: Partial<PerformanceSession> = { last_active: Date.now() };
    if (plan?.scene_basis === "chapter") {
      // Chapter re-enactment: cap at beats.length when segmented, otherwise uncapped
      const hasBeats = plan.beats.length > 0 && plan.segmented_source_text;
      if (!hasBeats || session.scene_progress < plan.beats.length - 1) {
        updates.scene_progress = session.scene_progress + 1;
      }
    } else if (totalBeats && session.scene_progress < totalBeats - 1) {
      updates.scene_progress = session.scene_progress + 1;
    }
    if (session.scene_progress === 0 && direction.trim() && !session.scene_directive) {
      updates.scene_directive = direction.trim();
    }
    await db.performance_sessions.update(session.id, updates);
  }
}

const COMPRESSION_TRIGGER = 5; // compress when uncompressed segments exceed this count
const COMPRESSION_KEEP_RAW = 2; // keep this many recent segments outside compression

export async function appendSegment(session_id: string, content: string, debug_prompt?: string): Promise<void> {
  const session = await db.performance_sessions.get(session_id);
  if (!session) return;

  const newSegment: GeneratedSegment = {
    segment_id: crypto.randomUUID(),
    type: "scene",
    canonicity: "extension",
    source_basis: {},
    contains_new_dialogue: true,
    contains_new_actions: true,
    user_directed: true,
    content,
    ...(debug_prompt ? { debug_prompt } : {}),
  };

  await db.performance_sessions.update(session_id, {
    generated_content: [...session.generated_content, newSegment],
    last_active: Date.now(),
  });

  // Trigger background compression if threshold exceeded (fire and forget)
  const updated = await db.performance_sessions.get(session_id);
  if (updated) {
    const compressedThrough = updated.compressed_through_index ?? -1;
    const uncompressed = updated.generated_content.length - compressedThrough - 1;
    if (uncompressed > COMPRESSION_TRIGGER && !updated.compression_in_progress) {
      triggerBackgroundCompression(session_id).catch(() => {});
    }
  }
}

export async function triggerBackgroundCompression(session_id: string): Promise<void> {
  const session = await db.performance_sessions.get(session_id);
  if (!session || session.compression_in_progress) return;

  const compressedThrough = session.compressed_through_index ?? -1;
  const uncompressedCount = session.generated_content.length - compressedThrough - 1;
  if (uncompressedCount <= COMPRESSION_TRIGGER) return;

  // Compress everything except the most recent COMPRESSION_KEEP_RAW segments
  const newCompressedThrough = session.generated_content.length - 1 - COMPRESSION_KEEP_RAW;
  if (newCompressedThrough <= compressedThrough) return;

  await db.performance_sessions.update(session_id, { compression_in_progress: true });

  try {
    const appSettings = await db.app_settings.get("global");
    const s = getStrings(langFromStorage(appSettings?.ui_language));

    let client = await LlmClient.forRole("compression");
    if (!client) client = await LlmClient.forRole("main");
    if (!client) return;

    // Build input: previous compression + newly added segments
    const parts: string[] = [];
    if (session.compressed_context) {
      parts.push(`${s.compression_context_label}\n${session.compressed_context}`);
    }
    const toCompress = session.generated_content.slice(compressedThrough + 1, newCompressedThrough + 1);
    parts.push(...toCompress.map((seg, i) => `【第${compressedThrough + 1 + i + 1}幕】\n${seg.content}`));

    const compressionInput = parts.join("\n\n");
    const result = await client.complete([
      { role: "system", content: s.compression_system },
      { role: "user", content: compressionInput },
    ]);

    await db.performance_sessions.update(session_id, {
      compressed_context: result,
      compressed_through_index: newCompressedThrough,
      compression_in_progress: false,
    });
  } catch {
    await db.performance_sessions.update(session_id, { compression_in_progress: false });
  }
}

export async function listPerformanceSessions(work_id: string): Promise<PerformanceSession[]> {
  const sessions = await db.performance_sessions
    .where("work_id")
    .equals(work_id)
    .sortBy("last_active");
  return sessions.reverse();
}

export async function deletePerformanceSession(id: string): Promise<void> {
  await db.performance_sessions.delete(id);
}

export async function* generatePlan(
  session: PerformanceSession,
  scene_basis: SceneBasis,
  user_description: string,
  reference_chapter?: number,
): AsyncGenerator<PlanProgressEvent> {
  // ── Load base context ───────────────────────────────────────────────────────
  const [work, rawEntities, settings, allChapters] = await Promise.all([
    db.works.get(session.work_id),
    db.entities.bulkGet(session.characters_in_scene),
    db.app_settings.get("global"),
    db.chapters.where("work_id").equals(session.work_id).toArray(),
  ]);
  const entities = rawEntities.filter((e): e is NonNullable<typeof e> => e != null);
  const maxLoops: number = settings?.plan_max_loops ?? 3;
  const debugMode: boolean = settings?.plan_debug_mode ?? false;

  const s = getStrings(langFromStorage(settings?.ui_language));

  const maxChapter = allChapters.length > 0
    ? Math.max(...allChapters.map(c => c.chapter_number))
    : 0;
  const cutoff = reference_chapter ?? maxChapter;

  let refChapter: Chapter | undefined;
  if (reference_chapter != null)
    refChapter = allChapters.find(c => c.chapter_number === reference_chapter);

  const entityNames = entities.map(e => e.canonical_name).join("、");
  const charList = entities.map(e => `- ${e.canonical_name} (id: "${e.id}")`).join("\n");
  const workTitle = work?.title ?? session.work_id;

  const seedContext = refChapter
    ? `${s.chapter_ref_prefix}第${refChapter.chapter_number}章「${refChapter.title}」\n${s.chapter_summary_prefix}${refChapter.summary_short}`
    : "";

  // Pre-load chapter full text for chapter re-enactment so the plan writer sees the
  // complete chapter and generates beats from beginning to end rather than from
  // whichever scene the research loop happens to retrieve first.
  const chapterFullText = refChapter?.full_text
    ? `\n\n${s.chapter_full_text_label}\n${refChapter.full_text}`
    : "";

  // ── Get LLM client — plan > sub_agent > main ────────────────────────────────
  let client = await LlmClient.forRole("plan");
  if (!client) client = await LlmClient.forRole("sub_agent");
  if (!client) client = await LlmClient.forRole("main");
  if (!client) throw new LlmError(0, "LLMが設定されていません。");

  // ── Research loop (multi-turn for KV cache efficiency) ──────────────────────
  const debugTrace: ResearchRound[] = [];
  const researchChunkIds = new Set<string>();
  // Chunks from search_passages are more precisely targeted than full-chapter chunks —
  // track separately to use as anchors when selecting source_chunk_ids
  const searchPassageChunkIds = new Set<string>();

  const isChapterReenactment = scene_basis === "chapter";

  // Fixed system message — identical across all research calls → maximum cache hits
  const researchSystemMsg: ChatMessage = {
    role: "system",
    content:
      `${isChapterReenactment ? s.research_role_chapter : s.research_role}\n\n` +
      `${s.work_label}: ${workTitle}\n` +
      `${s.characters_label}:\n${charList}\n` +
      `${s.scene_desc_label}: ${user_description}\n` +
      (seedContext ? `\n${seedContext}` : "") +
      chapterFullText +
      `\n\n${s.task_schema}`,
  };
  const researchMessages: ChatMessage[] = [researchSystemMsg];

  // Results not yet pushed into the conversation (supp results from eval phase,
  // or last-round task results deferred to the writing step user message)
  let pendingMaterial = "";

  for (let round = 1; round <= maxLoops; round++) {
    // 1. Planning phase — combine pending material with plan request in one user turn
    yield { type: "planning", round };

    const planContent = pendingMaterial
      ? `${s.research_supp_prefix}\n${pendingMaterial}\n\n${s.research_round_prompt}\n${s.research_json_hint}`
      : `${s.research_round_prompt}\n${s.research_json_hint}`;
    pendingMaterial = "";

    researchMessages.push({ role: "user", content: planContent });
    const planRaw = await client.complete(researchMessages);
    researchMessages.push({ role: "assistant", content: planRaw });
    const { reasoning: planReasoning, tasks } = parseTaskSpecs(planRaw);

    // Fallback: if LLM returned no valid tasks, do basic retrieval
    const effectiveTasks: TaskSpec[] = tasks.length > 0 ? tasks : (
      isChapterReenactment
        // Chapter mode: chapter text is already in system message; default to character profiles
        ? entities.slice(0, 3).map(e => ({ type: "get_character_profile" as const, character_id: e.id }))
        // Non-chapter: search + character profiles + full text if reference chapter set
        : [
            { type: "search_passages", query: user_description },
            ...entities.slice(0, 2).map(e => ({ type: "get_character_profile" as const, character_id: e.id })),
            ...(refChapter ? [{ type: "get_chapter_full_text" as const, chapter_number: refChapter.chapter_number }] : []),
          ]
    );

    // 2. Parallel task execution
    yield { type: "fetching", round, tasks: effectiveTasks.map(t => taskLabel(t, entities, s)) };

    const taskResults = await Promise.all(
      effectiveTasks.map(t => executeTask(t, session.work_id, cutoff, s, reference_chapter))
    );

    for (let i = 0; i < taskResults.length; i++) {
      const r = taskResults[i];
      if (r.chunk_ids) {
        r.chunk_ids.forEach(id => researchChunkIds.add(id));
        if (effectiveTasks[i].type === "search_passages") {
          r.chunk_ids.forEach(id => searchPassageChunkIds.add(id));
        }
      }
    }

    const roundMaterial = taskResults
      .filter(r => r.content.trim())
      .map(r => `=== ${r.label} ===\n${r.content}`)
      .join("\n\n");

    const debugTasks: ResearchTask[] = effectiveTasks.map((t, i) => ({
      type: t.type,
      label: taskResults[i].label,
      result_count: taskResults[i].count,
      result_preview: taskResults[i].content.slice(0, 300),
    }));

    // 3. Evaluation phase (skip on final loop)
    yield { type: "evaluating", round };

    let llmEvaluation = "";
    let sufficient = false;

    if (round < maxLoops) {
      // Push results + eval request as a single user turn (maintains strict alternation)
      const evalContent =
        `${s.research_results_prefix}\n${roundMaterial}\n\n${s.eval_instruction}\n${s.eval_json_hint}`;
      researchMessages.push({ role: "user", content: evalContent });
      const evalRaw = await client.complete(researchMessages);
      researchMessages.push({ role: "assistant", content: evalRaw });

      const judgment = parseSufficiencyJudgment(evalRaw);
      llmEvaluation = judgment.reasoning;
      sufficient = judgment.sufficient;

      if (!sufficient && judgment.additional_tasks.length > 0) {
        const suppResults = await Promise.all(
          judgment.additional_tasks.map(t => executeTask(t, session.work_id, cutoff, s))
        );
        const suppMaterial = suppResults
          .filter(r => r.content.trim())
          .map(r => `=== ${r.label} ===\n${r.content}`)
          .join("\n\n");
        // Carry to next round's plan user message (avoids consecutive user turns)
        if (suppMaterial) pendingMaterial = suppMaterial;
        for (let i = 0; i < suppResults.length; i++) {
          const r = suppResults[i];
          if (r.chunk_ids) {
            r.chunk_ids.forEach(id => researchChunkIds.add(id));
            if (judgment.additional_tasks[i].type === "search_passages") {
              r.chunk_ids.forEach(id => searchPassageChunkIds.add(id));
            }
          }
        }
        suppResults.forEach((r, i) => {
          debugTasks.push({
            type: judgment.additional_tasks[i].type,
            label: r.label,
            result_count: r.count,
            result_preview: r.content.slice(0, 300),
          });
        });
      }
    } else {
      // Last round: defer results to the writing step user message
      pendingMaterial = roundMaterial;
      sufficient = true;
      llmEvaluation = s.max_loops_msg;
    }

    if (debugMode) {
      debugTrace.push({ round, llm_plan: planReasoning, tasks: debugTasks, llm_evaluation: llmEvaluation, sufficient });
    }

    if (sufficient) break;
  }

  // source_chunk_ids is computed AFTER plan parsing below, so the plan content
  // and search_passages anchors can be used for precise scene location.
  let source_chunk_ids: string[] | undefined;

  // ── Plan generation — continues the research conversation ──────────────────
  yield { type: "writing" };

  const writeInstruction = isChapterReenactment ? s.write_instruction_chapter : s.write_instruction;
  const writeSchema = isChapterReenactment ? s.plan_json_schema_chapter : `${s.plan_json_schema}\n${s.plan_json_beats_hint}`;
  const writeContent = pendingMaterial
    ? `${s.research_results_prefix}\n${pendingMaterial}\n\n${writeInstruction}\n\n${s.json_only}\n${writeSchema}`
    : `${writeInstruction}\n\n${s.json_only}\n${writeSchema}`;
  researchMessages.push({ role: "user", content: writeContent });
  const raw = await client.complete(researchMessages);

  type PlanBody = Omit<ProductionPlan, "id" | "performance_session_id" | "created_at" | "scene_basis" | "reference_chapter" | "debug_trace" | "source_chunk_ids">;
  let rawParsed: Record<string, unknown>;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    rawParsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    rawParsed = {};
  }

  const defaultFields = {
    who: entities.map(e => e.canonical_name),
    where: "未指定", when: "未指定",
    what: user_description.slice(0, 80),
    why: "", how: "",
    props: [] as string[],
    tone_tags: [] as string[],
    beats: [] as Array<{ order: number; description: string }>,
    canonicity: "extension" as const,
  };

  // For chapter re-enactment: beats come from segmentation (below); supplementary_material is the key plan output.
  // For non-chapter: beats are required; supplementary_material is not used.
  const parsed: PlanBody = {
    ...defaultFields,
    ...(rawParsed as Partial<PlanBody>),
    beats: isChapterReenactment
      ? []
      : (Array.isArray(rawParsed.beats) ? rawParsed.beats as typeof defaultFields.beats : [{ order: 1, description: "場面を開始する" }]),
    supplementary_material: isChapterReenactment
      ? (typeof rawParsed.supplementary_material === "string" ? rawParsed.supplementary_material : "")
      : undefined,
  };

  // Select source_chunk_ids after plan generation.
  // Chapter re-enactment: always use all chunks in order — the sliding window in generateNextScene
  // distributes them per beat, guaranteeing beat 0 starts from the chapter's first passage.
  // Non-chapter: embedding > anchor > fallback to start.
  if (!source_chunk_ids) {
    if (reference_chapter != null && refChapter) {
      // For chapter re-enactment: use ALL chunks in narrative order.
      // generateNextScene's sliding window then distributes them evenly across beats,
      // ensuring beat 0 always covers the chapter's opening content.
      const allChapChunks = await db.chunks.where("chapter_id").equals(refChapter.id).sortBy("position");
      source_chunk_ids = allChapChunks.map(c => c.id);
    } else if (researchChunkIds.size > 0) {
      // Non-chapter scenarios: select a focused window from research-collected chunks
      const rawChunks = await db.chunks.bulkGet([...researchChunkIds]);
      const valid = rawChunks
        .filter((c): c is NonNullable<typeof c> => c != null)
        .sort((a, b) => (a.chapter_id === b.chapter_id ? a.position - b.position : a.chapter_id.localeCompare(b.chapter_id)));

      if (valid.length > 0) {
        const sceneWindowSize = Math.min(16, Math.max(8, Math.ceil(valid.length * 0.45)));

        if (valid.length <= sceneWindowSize) {
          source_chunk_ids = valid.map(c => c.id);
        } else {
          const beatContext = (parsed.beats ?? []).map(b => b.description).join(" ");
          let bestStart = 0;
          let located = false;

          // Priority 1: embedding against beats
          const embedder = await getEmbedder();
          if (embedder && valid.some(c => c.embedding)) {
            try {
              const [queryEmb] = await embedder([beatContext]);
              const embScores = valid.map(c => {
                const emb = toFloat32(c.embedding);
                return emb ? cosineSimilarity(queryEmb, emb) : 0;
              });
              let bestScore = -1;
              for (let i = 0; i <= valid.length - sceneWindowSize; i++) {
                const ws = embScores.slice(i, i + sceneWindowSize).reduce((a, b) => a + b, 0);
                if (ws > bestScore) { bestScore = ws; bestStart = i; }
              }
              located = true;
            } catch { /* fall through */ }
          }

          // Priority 2: search_passages anchor (targeted query from research LLM)
          if (!located) {
            const anchorIndices = valid
              .map((c, idx) => ({ idx, isAnchor: searchPassageChunkIds.has(c.id) }))
              .filter(x => x.isAnchor)
              .map(x => x.idx);
            if (anchorIndices.length > 0) {
              const anchorCenter = Math.round((Math.min(...anchorIndices) + Math.max(...anchorIndices)) / 2);
              bestStart = Math.max(0, Math.min(anchorCenter - Math.floor(sceneWindowSize / 3), valid.length - sceneWindowSize));
              located = true;
            }
          }

          void located;
          source_chunk_ids = valid.slice(bestStart, bestStart + sceneWindowSize).map(c => c.id);
        }
      }
    }
  }

  // Chapter mode: segment the chapter text into beats with <<<BEAT N: title>>> markers
  if (isChapterReenactment && refChapter?.full_text) {
    yield { type: "segmenting" };
    try {
      const segResult = await segmentChapterText(refChapter.full_text, client, s);
      if (segResult.beats.length > 0) {
        parsed.beats = segResult.beats.map(b => ({ order: b.n, description: b.title }));
        parsed.segmented_source_text = segResult.segmented_text;
      }
    } catch { /* non-fatal: fall back to no segmentation */ }
  }

  const plan: ProductionPlan = {
    id: crypto.randomUUID(),
    performance_session_id: session.id,
    created_at: Date.now(),
    scene_basis,
    reference_chapter,
    ...(source_chunk_ids ? { source_chunk_ids } : {}),
    ...(debugMode && debugTrace.length > 0 ? { debug_trace: debugTrace } : {}),
    ...parsed,
  };

  await db.production_plans.add(plan);
  await db.performance_sessions.update(session.id, { production_plan_id: plan.id });

  yield { type: "done", plan, session: { ...session, production_plan_id: plan.id } };
}

function taskLabel(spec: TaskSpec, entities: { id: string; canonical_name: string }[], s: Strings): string {
  const name = (id?: string) => entities.find(e => e.id === id)?.canonical_name ?? id ?? "";
  switch (spec.type) {
    case "search_passages":       return s.tl_search(spec.query ?? "", spec.character_id ? name(spec.character_id) : undefined);
    case "get_character_profile": return s.tl_profile(name(spec.character_id));
    case "get_chapter_detail":    return s.tl_chapter(spec.chapter_number ?? 0);
    case "get_chapter_full_text": return s.tl_chapter_full_text(spec.chapter_number ?? 0);
    case "find_co_appearances":   return s.tl_co_appearances((spec.character_ids ?? []).map(name).join("・"));
    case "search_events":         return s.tl_events(spec.query ?? "");
  }
}

export async function updatePlan(plan_id: string, updates: Partial<ProductionPlan>): Promise<void> {
  await db.production_plans.update(plan_id, updates);
}

export async function getPlanForSession(session_id: string): Promise<ProductionPlan | undefined> {
  return db.production_plans.where("performance_session_id").equals(session_id).first();
}

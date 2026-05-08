import { LlmClient, LlmError } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { PerformanceSession, PerformanceMode, ImprovSetting, GeneratedSegment, Chapter, ResearchRound, ResearchTask } from "@/lib/storage";
import type { ProductionPlan, SceneBasis } from "@/lib/storage";
import { retrieveChunks } from "@/lib/retrieval";

// ─── Research loop types ──────────────────────────────────────────────────────

interface TaskSpec {
  type: "search_passages" | "get_character_profile" | "get_chapter_detail" | "find_co_appearances" | "search_events";
  query?: string;
  character_id?: string;
  chapter_number?: number;
  character_ids?: string[];
}

interface TaskResult {
  label: string;
  content: string;
  count: number;
}

export type PlanProgressEvent =
  | { type: "planning"; round: number }
  | { type: "fetching"; round: number; tasks: string[] }
  | { type: "evaluating"; round: number }
  | { type: "writing" }
  | { type: "done"; plan: ProductionPlan; session: PerformanceSession };

// ─── Task execution ───────────────────────────────────────────────────────────

async function executeTask(spec: TaskSpec, work_id: string, cutoff: number): Promise<TaskResult> {
  try {
    switch (spec.type) {
      case "search_passages": {
        const results = await retrieveChunks(work_id, spec.query ?? "", cutoff, 5, spec.character_id);
        const texts = results.map(r => r.chunk.text);
        return { label: `「${spec.query}」を検索`, content: texts.join("\n---\n"), count: texts.length };
      }
      case "get_character_profile": {
        const [entity, ext] = await Promise.all([
          db.entities.get(spec.character_id ?? ""),
          db.characters_extended.get(spec.character_id ?? ""),
        ]);
        if (!entity) return { label: "キャラクター取得", content: "", count: 0 };
        const lines = [
          `【${entity.canonical_name}】`,
          entity.description,
          ext?.persona ? `人格: ${ext.persona}` : "",
          ext?.speech_style ? `話し方: ${ext.speech_style}` : "",
        ].filter(Boolean);
        return { label: `${entity.canonical_name}のプロフィール取得`, content: lines.join("\n"), count: 1 };
      }
      case "get_chapter_detail": {
        const chapter = await db.chapters
          .where("work_id").equals(work_id)
          .filter(c => c.chapter_number === (spec.chapter_number ?? 0))
          .first();
        if (!chapter) return { label: `第${spec.chapter_number}章取得`, content: "", count: 0 };
        const lines = [
          `【第${chapter.chapter_number}章「${chapter.title}」】`,
          chapter.summary_medium || chapter.summary_short,
          chapter.key_events.length > 0 ? "主な出来事:\n" + chapter.key_events.slice(0, 8).map(e => `・${e}`).join("\n") : "",
        ].filter(Boolean);
        return { label: `第${chapter.chapter_number}章「${chapter.title}」の詳細取得`, content: lines.join("\n"), count: 1 };
      }
      case "find_co_appearances": {
        const ids = spec.character_ids ?? [];
        const allChapters = await db.chapters.where("work_id").equals(work_id).toArray();
        const chapIds = allChapters.map(c => c.id);
        const chunks = chapIds.length > 0
          ? await db.chunks.where("chapter_id").anyOf(chapIds)
              .filter(c => ids.every(id => c.characters_present.includes(id)))
              .toArray()
          : [];
        const top = chunks.slice(0, 5).map(c => c.text);
        return { label: `共演シーン検索 (${ids.length}名)`, content: top.join("\n---\n"), count: top.length };
      }
      case "search_events": {
        const query = (spec.query ?? "").toLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);
        const chapters = await db.chapters.where("work_id").equals(work_id)
          .filter(c => c.chapter_number <= cutoff).toArray();
        const hits = chapters
          .flatMap(c => c.key_events.map(e => ({ ch: c.chapter_number, e })))
          .filter(({ e }) => terms.some(t => e.toLowerCase().includes(t)))
          .slice(0, 10)
          .map(({ ch, e }) => `第${ch}章: ${e}`);
        return { label: `「${spec.query}」イベント検索`, content: hits.join("\n"), count: hits.length };
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
    const validTypes = new Set(["search_passages", "get_character_profile", "get_chapter_detail", "find_co_appearances", "search_events"]);
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
    const validTypes = new Set(["search_passages", "get_character_profile", "get_chapter_detail", "find_co_appearances", "search_events"]);
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
): Promise<PerformanceSession> {
  const session: PerformanceSession = {
    id: crypto.randomUUID(),
    work_id,
    mode,
    template_id: "default",
    performer_skill_assignments: {},
    characters_in_scene: character_ids,
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

export async function* generateNextScene(
  session: PerformanceSession,
  direction: string,
  signal?: AbortSignal,
  plan?: ProductionPlan,
): AsyncGenerator<string> {
  // 1. Load work
  const work = await db.works.get(session.work_id);

  // 2. Load entities and charExts
  const [entities, charExts] = await Promise.all([
    db.entities.bulkGet(session.characters_in_scene),
    db.characters_extended.bulkGet(session.characters_in_scene),
  ]);

  // 3. Build system prompt (Japanese)
  const workTitle = work?.title ?? session.work_id;
  const systemParts: string[] = [];

  systemParts.push(`作品: ${workTitle}`);

  // Characters block
  const characterLines: string[] = [];
  for (let i = 0; i < session.characters_in_scene.length; i++) {
    const entity = entities[i];
    const charExt = charExts[i];
    if (!entity) continue;
    let line = `${entity.canonical_name}: ${entity.description}`;
    if (charExt?.speech_style) {
      line += `（話し方: ${charExt.speech_style}）`;
    }
    characterLines.push(line);
  }
  if (characterLines.length > 0) {
    systemParts.push(characterLines.join("\n"));
  }

  // Mode instruction
  const firstCharacterName = entities[0]?.canonical_name ?? "キャラクター";
  switch (session.mode) {
    case "director":
      systemParts.push("読者は監督として演出を指示します。指示に従って場面を脚本形式で生成してください。");
      break;
    case "screenwriter":
      systemParts.push("読者は脚本家として場面の方向性を示します。脚本形式で展開してください。");
      break;
    case "cast":
      systemParts.push(`読者は${firstCharacterName}を演じます。他のキャラクターはあなたが担当します。`);
      break;
    case "hybrid":
      systemParts.push("読者は複数の役割を担います。指示に従い脚本形式で生成してください。");
      break;
  }

  // Improv setting
  switch (session.improvisation_setting) {
    case "strict":
      systemParts.push("原作の設定と関係性を厳密に守ってください。");
      break;
    case "moderate":
      systemParts.push("原作設定を基本的に守りつつ、自然な展開を加えてください。");
      break;
    case "free":
      systemParts.push("原作設定を参考に、自由に展開を生成してください。");
      break;
  }

  // Inject production plan if available
  if (plan) {
    const beatIndex = session.scene_progress;
    const currentBeat = plan.beats[beatIndex] ?? plan.beats[plan.beats.length - 1];
    const planLines = [
      `演出計画:`,
      `  場所: ${plan.where}`,
      `  時間: ${plan.when}`,
      `  概要: ${plan.what}`,
      `  背景: ${plan.why}`,
      `  トーン: ${plan.tone_tags.join('、')}`,
    ];
    if (plan.props.length > 0) planLines.push(`  道具: ${plan.props.join('、')}`);
    if (currentBeat) planLines.push(`  現在の幕: ビート${beatIndex + 1}/${plan.beats.length} — ${currentBeat.description}`);
    systemParts.push(planLines.join("\n"));
  }

  // Format
  systemParts.push("脚本形式（キャラクター名: セリフ / ト書き）で出力してください。800字以内。");

  const systemMessage: ChatMessage = {
    role: "system",
    content: systemParts.join("\n\n"),
  };

  // 5. Previous context: last 3 segments
  const previousContext = session.generated_content.slice(-3).map(s => s.content).join("\n\n---\n\n");
  const messages: ChatMessage[] = [systemMessage];

  if (previousContext) {
    messages.push({ role: "assistant", content: previousContext });
  }

  // 6. User message
  const userContent = direction.trim() !== "" ? direction : "続きを生成";
  messages.push({ role: "user", content: userContent });

  // 7. Get LLM client
  const client = await LlmClient.forRole("main");
  if (!client) {
    throw new LlmError(0, "LLMが設定されていません。");
  }

  // 8. Yield from stream
  try {
    for await (const chunk of client.stream(messages, signal)) {
      if (chunk.delta) yield chunk.delta;
    }
  } finally {
    const updates: Partial<PerformanceSession> = { last_active: Date.now() };
    if (plan && session.scene_progress < plan.beats.length - 1) {
      updates.scene_progress = session.scene_progress + 1;
    }
    await db.performance_sessions.update(session.id, updates);
  }
}

export async function appendSegment(session_id: string, content: string): Promise<void> {
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
  };

  await db.performance_sessions.update(session_id, {
    generated_content: [...session.generated_content, newSegment],
    last_active: Date.now(),
  });
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

const PLAN_JSON_SCHEMA =
  `{\n` +
  `  "who": ["キャラクター名"],\n` +
  `  "where": "場所と状況",\n` +
  `  "when": "時間帯や時期",\n` +
  `  "what": "この場面で起きることの一文要約",\n` +
  `  "why": "背景・動機",\n` +
  `  "how": "演出のトーンや手法",\n` +
  `  "props": ["道具1"],\n` +
  `  "tone_tags": ["緊張", "疑惑"],\n` +
  `  "beats": [\n` +
  `    {"order": 1, "description": "最初に起きること"},\n` +
  `    {"order": 2, "description": "次の展開"},\n` +
  `    {"order": 3, "description": "クライマックス"}\n` +
  `  ],\n` +
  `  "canonicity": "re_enactment" | "extension" | "speculation" | "alternate"\n` +
  `}`;

const TASK_SCHEMA =
  `利用可能なタスク種別:\n` +
  `- search_passages: { "type": "search_passages", "query": "検索クエリ", "character_id": "id（任意）" }\n` +
  `- get_character_profile: { "type": "get_character_profile", "character_id": "id" }\n` +
  `- get_chapter_detail: { "type": "get_chapter_detail", "chapter_number": N }\n` +
  `- find_co_appearances: { "type": "find_co_appearances", "character_ids": ["id1", "id2"] }\n` +
  `- search_events: { "type": "search_events", "query": "イベント検索クエリ" }`;

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

  const maxChapter = allChapters.length > 0
    ? Math.max(...allChapters.map(c => c.chapter_number))
    : 0;
  const cutoff = reference_chapter ?? maxChapter;

  let refChapter: Chapter | undefined;
  if (reference_chapter != null)
    refChapter = allChapters.find(c => c.chapter_number === reference_chapter);

  // Character reference for LLM (name → id mapping in prompt)
  const entityNames = entities.map(e => e.canonical_name).join("、");
  const charList = entities.map(e => `- ${e.canonical_name} (id: "${e.id}")`).join("\n");
  const workTitle = work?.title ?? session.work_id;

  // Seed context: reference chapter header (no full text yet — let LLM decide what to pull)
  const seedContext = refChapter
    ? `参照章: 第${refChapter.chapter_number}章「${refChapter.title}」\n概要: ${refChapter.summary_short}`
    : "";

  // ── Get LLM client ──────────────────────────────────────────────────────────
  let client = await LlmClient.forRole("sub_agent");
  if (!client) client = await LlmClient.forRole("main");
  if (!client) throw new LlmError(0, "LLMが設定されていません。");

  // ── Research loop ───────────────────────────────────────────────────────────
  let accumulatedMaterial = "";
  const debugTrace: ResearchRound[] = [];

  for (let round = 1; round <= maxLoops; round++) {
    // 1. Planning phase
    yield { type: "planning", round };

    const planningPrompt =
      `あなたは演出の調査責任者です。演出計画を作成するために必要な調査タスクを決定してください。\n\n` +
      `作品: ${workTitle}\n` +
      `出演キャラクター:\n${charList}\n` +
      `場面の説明: ${user_description}\n` +
      (seedContext ? `${seedContext}\n` : "") +
      (accumulatedMaterial
        ? `\n【既収集素材（${round > 1 ? "前回までの調査結果" : "なし"}）】\n${accumulatedMaterial.slice(0, 4000)}\n`
        : "\n【既収集素材】なし（初回調査）\n") +
      `\n${TASK_SCHEMA}\n\n` +
      `JSONのみ返答:\n` +
      `{ "reasoning": "何を調査すべきか理由", "tasks": [...] }`;

    const planRaw = await client.complete([{ role: "user", content: planningPrompt }]);
    const { reasoning: planReasoning, tasks } = parseTaskSpecs(planRaw);

    // Fallback: if LLM returned no valid tasks, do basic retrieval
    const effectiveTasks: TaskSpec[] = tasks.length > 0 ? tasks : [
      { type: "search_passages", query: user_description },
      ...entities.slice(0, 2).map(e => ({ type: "get_character_profile" as const, character_id: e.id })),
      ...(refChapter ? [{ type: "get_chapter_detail" as const, chapter_number: refChapter.chapter_number }] : []),
    ];

    // 2. Parallel task execution
    yield { type: "fetching", round, tasks: effectiveTasks.map(t => taskLabel(t, entities)) };

    const taskResults = await Promise.all(
      effectiveTasks.map(t => executeTask(t, session.work_id, cutoff))
    );

    // Accumulate material
    const roundMaterial = taskResults
      .filter(r => r.content.trim())
      .map(r => `=== ${r.label} ===\n${r.content}`)
      .join("\n\n");
    accumulatedMaterial += (accumulatedMaterial ? "\n\n" : "") + roundMaterial;

    // Build debug tasks
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
      const evalPrompt =
        `以下の調査素材をもとに、演出計画の作成に十分な情報が揃っているか評価してください。\n\n` +
        `場面の説明: ${user_description}\n出演: ${entityNames}\n\n` +
        `【収集済み素材】\n${accumulatedMaterial.slice(0, 5000)}\n\n` +
        `JSONのみ返答:\n` +
        `{ "reasoning": "評価の理由と不足点", "sufficient": true|false, "additional_tasks": [...] }`;

      const evalRaw = await client.complete([{ role: "user", content: evalPrompt }]);
      const judgment = parseSufficiencyJudgment(evalRaw);
      llmEvaluation = judgment.reasoning;
      sufficient = judgment.sufficient;

      // If not sufficient but has additional tasks, inject them for next round
      // by pre-populating (they'll be included in the next iteration's accumulated material context)
      if (!sufficient && judgment.additional_tasks.length > 0) {
        // Execute supplementary tasks immediately and append to material
        const suppResults = await Promise.all(
          judgment.additional_tasks.map(t => executeTask(t, session.work_id, cutoff))
        );
        const suppMaterial = suppResults
          .filter(r => r.content.trim())
          .map(r => `=== ${r.label} ===\n${r.content}`)
          .join("\n\n");
        if (suppMaterial) accumulatedMaterial += "\n\n" + suppMaterial;
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
      sufficient = true;
      llmEvaluation = "最大ループ数に達したため強制終了。";
    }

    if (debugMode) {
      debugTrace.push({ round, llm_plan: planReasoning, tasks: debugTasks, llm_evaluation: llmEvaluation, sufficient });
    }

    if (sufficient) break;
  }

  // ── Plan generation ─────────────────────────────────────────────────────────
  yield { type: "writing" };

  const writingPrompt =
    `以下の調査素材をもとに、演出計画をJSONで生成してください。\n` +
    `原文のトーン・セリフ・雰囲気・人物関係を忠実に反映すること。\n\n` +
    `作品: ${workTitle}\n出演: ${entityNames}\n場面の説明: ${user_description}\n\n` +
    `【調査素材】\n${accumulatedMaterial.slice(0, 7000)}\n\n` +
    `JSONのみ返答:\n${PLAN_JSON_SCHEMA}\nbeats は3〜5項目。日本語で出力。`;

  const raw = await client.complete([{ role: "user", content: writingPrompt }]);

  type PlanBody = Omit<ProductionPlan, "id" | "performance_session_id" | "created_at" | "scene_basis" | "reference_chapter" | "debug_trace">;
  let parsed: PlanBody;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(jsonText) as PlanBody;
  } catch {
    parsed = {
      who: entities.map(e => e.canonical_name),
      where: "未指定", when: "未指定",
      what: user_description.slice(0, 80),
      why: "", how: "脚本形式",
      props: [], tone_tags: [],
      beats: [{ order: 1, description: "場面を開始する" }],
      canonicity: "extension",
    };
  }

  const plan: ProductionPlan = {
    id: crypto.randomUUID(),
    performance_session_id: session.id,
    created_at: Date.now(),
    scene_basis,
    reference_chapter,
    ...(debugMode && debugTrace.length > 0 ? { debug_trace: debugTrace } : {}),
    ...parsed,
  };

  await db.production_plans.add(plan);
  await db.performance_sessions.update(session.id, { production_plan_id: plan.id });

  yield { type: "done", plan, session: { ...session, production_plan_id: plan.id } };
}

function taskLabel(spec: TaskSpec, entities: { id: string; canonical_name: string }[]): string {
  const name = (id?: string) => entities.find(e => e.id === id)?.canonical_name ?? id ?? "";
  switch (spec.type) {
    case "search_passages": return `「${spec.query}」を検索${spec.character_id ? ` (${name(spec.character_id)})` : ""}`;
    case "get_character_profile": return `${name(spec.character_id)}のプロフィール取得`;
    case "get_chapter_detail": return `第${spec.chapter_number}章の詳細取得`;
    case "find_co_appearances": return `共演シーン検索 (${(spec.character_ids ?? []).map(name).join("・")})`;
    case "search_events": return `「${spec.query}」イベント検索`;
  }
}

export async function updatePlan(plan_id: string, updates: Partial<ProductionPlan>): Promise<void> {
  await db.production_plans.update(plan_id, updates);
}

export async function getPlanForSession(session_id: string): Promise<ProductionPlan | undefined> {
  return db.production_plans.where("performance_session_id").equals(session_id).first();
}

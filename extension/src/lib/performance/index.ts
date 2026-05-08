import { LlmClient, LlmError } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { PerformanceSession, PerformanceMode, ImprovSetting, GeneratedSegment } from "@/lib/storage";
import type { ProductionPlan, SceneBasis } from "@/lib/storage";

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

export async function generatePlan(
  session: PerformanceSession,
  scene_basis: SceneBasis,
  user_description: string,
  reference_chapter?: number,
): Promise<{ plan: ProductionPlan; session: PerformanceSession }> {
  // 1. Load work
  const work = await db.works.get(session.work_id);

  // 2. Load entities, filter nulls
  const rawEntities = await db.entities.bulkGet(session.characters_in_scene);
  const entities = rawEntities.filter((e): e is NonNullable<typeof e> => e != null);

  // 3. Optionally load reference chapter summary
  let chapterSummary: string | undefined;
  if (reference_chapter != null) {
    const chapter = await db.chapters
      .where("work_id")
      .equals(session.work_id)
      .filter(c => c.chapter_number === reference_chapter)
      .first();
    chapterSummary = chapter?.summary_short;
  }

  // 4. Build LLM prompt
  const entityNames = entities.map(e => e.canonical_name).join("、");
  const refLine = chapterSummary ? `\n参照章概要: ${chapterSummary}` : "";
  const promptText =
    `以下の情報をもとに演出計画をJSONで生成してください。\n\n` +
    `作品: ${work?.title ?? session.work_id}\n` +
    `出演: ${entityNames}${refLine}\n` +
    `場面の説明: ${user_description}\n\n` +
    `JSON形式で返してください（説明不要、JSONのみ）:\n` +
    `{\n` +
    `  "who": ["キャラクター名"],\n` +
    `  "where": "場所と状況",\n` +
    `  "when": "時間帯や時期",\n` +
    `  "what": "この場面で起きることの一文要約",\n` +
    `  "why": "背景・動機",\n` +
    `  "how": "演出のトーンや手法",\n` +
    `  "props": ["道具1", "道具2"],\n` +
    `  "tone_tags": ["緊張", "疑惑"],\n` +
    `  "beats": [\n` +
    `    {"order": 1, "description": "最初に起きること"},\n` +
    `    {"order": 2, "description": "次の展開"},\n` +
    `    {"order": 3, "description": "クライマックス"}\n` +
    `  ],\n` +
    `  "canonicity": "re_enactment" | "extension" | "speculation" | "alternate"\n` +
    `}\n` +
    `beats は3〜5項目。日本語で出力。`;

  const messages: ChatMessage[] = [
    { role: "user", content: promptText },
  ];

  // 5. Get LLM client: prefer sub_agent, fall back to main
  let client = await LlmClient.forRole("sub_agent");
  if (!client) client = await LlmClient.forRole("main");
  if (!client) throw new LlmError(0, "LLMが設定されていません。");

  // 6. Call complete (full JSON)
  const raw = await client.complete(messages);

  // 7. Parse JSON; build fallback on error
  type PlanBody = Omit<ProductionPlan, "id" | "performance_session_id" | "created_at" | "scene_basis" | "reference_chapter">;
  let parsed: PlanBody;
  try {
    // Strip markdown code fences if present
    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(jsonText) as PlanBody;
  } catch {
    const fallback: PlanBody = {
      who: entities.map(e => e.canonical_name),
      where: "未指定",
      when: "未指定",
      what: user_description.slice(0, 80),
      why: "",
      how: "脚本形式",
      props: [],
      tone_tags: [],
      beats: [{ order: 1, description: "場面を開始する" }],
      canonicity: "extension",
    };
    parsed = fallback;
  }

  // 8. Build plan object
  const plan: ProductionPlan = {
    id: crypto.randomUUID(),
    performance_session_id: session.id,
    created_at: Date.now(),
    scene_basis,
    reference_chapter,
    ...parsed,
  };

  // 9. Save plan
  await db.production_plans.add(plan);

  // 10. Update session with plan id
  await db.performance_sessions.update(session.id, { production_plan_id: plan.id });

  // 11. Return
  return { plan, session: { ...session, production_plan_id: plan.id } };
}

export async function updatePlan(plan_id: string, updates: Partial<ProductionPlan>): Promise<void> {
  await db.production_plans.update(plan_id, updates);
}

export async function getPlanForSession(session_id: string): Promise<ProductionPlan | undefined> {
  return db.production_plans.where("performance_session_id").equals(session_id).first();
}

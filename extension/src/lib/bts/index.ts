import { LlmClient, LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { BtsCrewMember, BtsLocation, BtsSession, BtsTurn, PerformerSkill, PerformanceSession } from "@/lib/storage";

export interface BtsSetup {
  location: BtsLocation;
  crew: BtsCrewMember[];
}

export async function getOrCreateSkill(character_id: string, work_id: string): Promise<PerformerSkill> {
  // 1. Return existing skill if present
  const existing = await db.performer_skills.get(character_id);
  if (existing) return existing;

  // 2. Load entity and charExt
  const [entity, charExt] = await Promise.all([
    db.entities.get(character_id),
    db.characters_extended.get(character_id),
  ]);

  const name = entity?.canonical_name ?? character_id;
  const description = entity?.description ?? "";
  const speechStyle = charExt?.speech_style ?? "";

  // 3. Get LLM client (prefer sub_agent, fallback to main)
  const client = (await LlmClient.forRole("sub_agent")) ?? (await LlmClient.forRole("main"));

  interface GeneratedPersona {
    archetype?: string;
    personality_traits?: string[];
    speech_patterns?: string[];
    off_set_persona?: {
      casual_style?: string;
      quirks?: string[];
      interests?: string[];
      relationships_with_others?: Record<string, string>;
    };
    signature_style?: {
      acting_method?: string;
      strengths?: string[];
      notable_techniques?: string[];
    };
    contrast_with_role_hints?: string;
  }

  let persona: GeneratedPersona = {};

  if (client) {
    const systemPrompt = [
      "架空の声優プロフィールをJSONで生成してください。",
      `キャラクター: ${name}`,
      `説明: ${description}`,
      speechStyle ? `話し方: ${speechStyle}` : "",
      "",
      '必須フィールド: {"archetype":"...","personality_traits":[...],"speech_patterns":[...],"off_set_persona":{"casual_style":"...","quirks":[...],"interests":[]},"signature_style":{"acting_method":"...","strengths":[],"notable_techniques":[]},"contrast_with_role_hints":"..."}',
      "JSONのみ返却。",
    ].filter(l => l !== undefined).join("\n");

    try {
      const raw = await client.complete([
        { role: "system", content: systemPrompt },
        { role: "user", content: "生成" },
      ]);
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      persona = JSON.parse(cleaned) as GeneratedPersona;
    } catch {
      // Parse error — use minimal defaults below
    }
  }

  // 5. Build PerformerSkill
  const skill: PerformerSkill = {
    id: character_id,
    source: "ai_generated",
    name: `${name}役・声優`,
    background_type: "fictional",
    archetype: persona.archetype ?? "声優",
    personality_traits: persona.personality_traits ?? [],
    speech_patterns: persona.speech_patterns ?? [],
    off_set_persona: {
      casual_style: persona.off_set_persona?.casual_style ?? "",
      quirks: persona.off_set_persona?.quirks ?? [],
      interests: persona.off_set_persona?.interests ?? [],
      relationships_with_others: persona.off_set_persona?.relationships_with_others ?? {},
    },
    signature_style: {
      acting_method: persona.signature_style?.acting_method ?? "",
      strengths: persona.signature_style?.strengths ?? [],
      notable_techniques: persona.signature_style?.notable_techniques ?? [],
    },
    contrast_with_role_hints: persona.contrast_with_role_hints ?? "",
    off_set_interests: persona.off_set_persona?.interests ?? [],
    loaded_at: Date.now(),
    validation_status: "ok",
  };

  // 6. Save and return
  await db.performer_skills.add(skill);
  return skill;
}

export async function regenerateSkill(character_id: string, work_id: string): Promise<PerformerSkill> {
  await db.performer_skills.delete(character_id);
  return getOrCreateSkill(character_id, work_id);
}

export async function saveSkillField(character_id: string, updates: Partial<PerformerSkill>): Promise<void> {
  await db.performer_skills.update(character_id, updates);
}

export async function generateBtsSetup(
  performanceSession: PerformanceSession,
  description: string,
): Promise<BtsSetup> {
  const work = await db.works.get(performanceSession.work_id);
  const rawEntities = await db.entities.bulkGet(performanceSession.characters_in_scene);
  const characterNames = rawEntities
    .filter((e): e is NonNullable<typeof e> => e != null)
    .map(e => e.canonical_name);

  const prompt = [
    `作品「${work?.title ?? performanceSession.work_id}」の幕後（楽屋）シーンを設定してください。`,
    "",
    `出演者: ${characterNames.join("、")}`,
    `シチュエーション: ${description}`,
    "",
    "JSONのみ返却（説明不要）:",
    '{',
    '  "location": "makeup_room" | "set" | "rest_area" | "cafeteria",',
    '  "crew": [',
    '    { "role": "照明担当", "name": "架空の名前", "persona_snippet": "一行の人物描写" },',
    '    ...',
    '  ]',
    '}',
    "",
    "location の選択基準:",
    "- makeup_room: 化粧・衣装に関する描写があれば",
    "- set: 撮影・演技の場面があれば",
    "- rest_area: 休憩・雑談があれば",
    "- cafeteria: 食事・飲み物があれば",
    "",
    "crew は location に応じて2〜4名を生成:",
    "- makeup_room: ヘアメイク、衣装担当",
    "- set: 場記、照明担当、収音担当、道具担当",
    "- rest_area: スタッフ（汎用）",
    "- cafeteria: ケータリングスタッフ、アシスタント",
    "",
    "persona_snippetは一行（20字以内）。日本語で出力。",
  ].join("\n");

  const client = (await LlmClient.forRole("sub_agent")) ?? (await LlmClient.forRole("main"));
  if (!client) {
    return { location: "rest_area", crew: [] };
  }

  let raw: string;
  try {
    raw = await client.complete([
      { role: "system", content: prompt },
      { role: "user", content: "生成" },
    ]);
  } catch {
    return { location: "rest_area", crew: [] };
  }

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  interface RawSetup {
    location?: string;
    crew?: BtsCrewMember[];
  }

  let parsed: RawSetup;
  try {
    parsed = JSON.parse(cleaned) as RawSetup;
  } catch {
    return { location: "rest_area", crew: [] };
  }

  const validLocations: BtsLocation[] = ["makeup_room", "set", "rest_area", "cafeteria"];
  const location: BtsLocation = validLocations.includes(parsed.location as BtsLocation)
    ? (parsed.location as BtsLocation)
    : "rest_area";
  const crew: BtsCrewMember[] = Array.isArray(parsed.crew) ? parsed.crew : [];

  return { location, crew };
}

export async function createBtsSession(
  work_id: string,
  character_ids: string[],
  location: BtsLocation = "rest_area",
  crew: BtsCrewMember[] = [],
): Promise<BtsSession> {
  const session: BtsSession = {
    id: crypto.randomUUID(),
    work_id,
    present_performers: character_ids,
    present_crew: crew,
    location,
    conversation_history: [],
    created_at: Date.now(),
    last_active: Date.now(),
  };
  await db.bts_sessions.add(session);
  return session;
}

export async function* btsChat(
  session: BtsSession,
  target_skill_id: string,
  user_message: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  // 1. Load PerformerSkill and entity
  const [skill, entity] = await Promise.all([
    db.performer_skills.get(target_skill_id),
    db.entities.get(target_skill_id),
  ]);

  const characterName = entity?.canonical_name ?? target_skill_id;
  const casualStyle = skill?.off_set_persona?.casual_style ?? "";
  const interests = skill?.off_set_persona?.interests ?? [];
  const quirks = skill?.off_set_persona?.quirks ?? [];

  // 3. Build system prompt
  const systemContent = [
    `あなたは架空の声優です。「${characterName}」というキャラクターを演じています。`,
    "今は収録の合間で楽屋にいます。キャラクターとしてではなく、そのキャラクターを演じた声優として自然に話してください。",
    "",
    `口調・話し方: ${casualStyle}`,
    `趣味・関心: ${interests.join("、")}`,
    `口癖やクセ: ${quirks.join("、")}`,
  ].join("\n");

  // 4. Build message history from last 12 turns
  const history = session.conversation_history.slice(-12).map(turn => ({
    role: (turn.speaker_skill_id === target_skill_id ? "assistant" : "user") as "assistant" | "user",
    content: turn.content,
  }));

  // 5. Append user message
  const messages = [
    { role: "system" as const, content: systemContent },
    ...history,
    { role: "user" as const, content: user_message },
  ];

  // 6. Get LLM client
  const client = await LlmClient.forRole("main");
  if (!client) {
    throw new LlmError(0, "LLMが設定されていません。");
  }

  // 7. Yield from stream
  try {
    for await (const chunk of client.stream(messages, signal)) {
      if (chunk.delta) yield chunk.delta;
    }
  } finally {
    // 8. Update last_active
    await db.bts_sessions.update(session.id, { last_active: Date.now() });
  }
}

export async function appendBtsTurn(session_id: string, turn: BtsTurn): Promise<void> {
  await db.bts_sessions.update(session_id, session => {
    session.conversation_history.push(turn);
    session.last_active = Date.now();
  });
}

export async function listBtsSessions(work_id: string): Promise<BtsSession[]> {
  const sessions = await db.bts_sessions
    .where("work_id")
    .equals(work_id)
    .sortBy("last_active");
  return sessions.reverse();
}

export async function generateCrewInterjection(
  session: BtsSession,
  lastExchange: string,
): Promise<string | null> {
  if (session.present_crew.length === 0) return null;
  if (Math.random() > 0.15) return null;

  const member = session.present_crew[Math.floor(Math.random() * session.present_crew.length)];

  const locationLabels: Record<BtsLocation, string> = {
    makeup_room: "化粧室",
    set: "撮影セット",
    rest_area: "休憩室",
    cafeteria: "食堂",
  };
  const locationLabel = locationLabels[session.location];

  const prompt = [
    `あなたは${member.role}の${member.name}です。${locationLabel}にいます。`,
    `性格: ${member.persona_snippet}`,
    "",
    "今の会話の流れ:",
    lastExchange,
    "",
    "場の雰囲気に合う短い一言を言ってください。1〜2文。キャラクター名や「声優」という言葉は使わないこと。",
  ].join("\n");

  const client = (await LlmClient.forRole("sub_agent")) ?? (await LlmClient.forRole("main"));
  if (!client) return null;

  let response: string;
  try {
    response = await client.complete([
      { role: "system", content: prompt },
      { role: "user", content: "一言" },
    ]);
  } catch {
    return null;
  }

  return `**${member.name}（${member.role}）**: ${response.trim()}`;
}

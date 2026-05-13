import { LlmClient, LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { BtsCrewMember, BtsLocation, BtsSession, BtsTurn, Entity, PerformerSkill, PerformanceSession } from "@/lib/storage";
import { getStrings, langFromStorage } from "@/lib/i18n";

export interface BtsGroupTurn {
  speaker_skill_id: string;
  speaker_name: string;
  turn_type: "dialogue" | "action";
  content: string;
}

export type BtsStreamChunk =
  | { event: "turn_done"; turn: BtsGroupTurn }
  | { event: "all_done" };

export interface SkillWithEntity {
  skill: PerformerSkill;
  entity: Entity;
}

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
      "架空の俳優プロフィールをJSONで生成してください。映画・テレビドラマ出身の俳優です。",
      `担当キャラクター: ${name}`,
      `キャラクター説明: ${description}`,
      speechStyle ? `キャラクターの話し方: ${speechStyle}` : "",
      "",
      '必須フィールド: {"archetype":"...","personality_traits":[...],"speech_patterns":[...],"off_set_persona":{"casual_style":"...","quirks":[...],"interests":[]},"signature_style":{"acting_method":"...","strengths":[],"notable_techniques":[]},"contrast_with_role_hints":"..."}',
      "archetype は俳優としての役柄タイプ（例：個性派、実力派、アイドル系など）。",
      "off_set_persona はプライベートや撮影現場での素の人格。",
      "contrast_with_role_hints は担当キャラクターとの性格的な違い。",
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
    name: `${name}役・俳優`,
    background_type: "fictional",
    archetype: persona.archetype ?? "俳優",
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

  const appSettings = await db.app_settings.get("global");
  const s = getStrings(langFromStorage(appSettings?.ui_language));

  const characterName = entity?.canonical_name ?? target_skill_id;
  const casualStyle = skill?.off_set_persona?.casual_style ?? "";
  const interests = skill?.off_set_persona?.interests ?? [];
  const quirks = skill?.off_set_persona?.quirks ?? [];

  // 3. Build system prompt using locale strings
  const systemParts = [s.bts_sys_intro(characterName), s.bts_sys_context];
  if (casualStyle) systemParts.push(s.bts_sys_casual(casualStyle));
  if (interests.length) systemParts.push(s.bts_sys_interests(interests.join("、")));
  if (quirks.length) systemParts.push(s.bts_sys_quirks(quirks.join("、")));
  const systemContent = systemParts.join("\n");

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

// ── Group chat ────────────────────────────────────────────────────────────────

function tryExtractObjects(buffer: string): { turns: BtsGroupTurn[]; remaining: string } {
  const turns: BtsGroupTurn[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const start = buffer.indexOf("{", pos);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escape = false;
    let i = start;

    for (; i < buffer.length; i++) {
      const c = buffer[i];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (!inString) {
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            try {
              const raw = JSON.parse(buffer.slice(start, i + 1)) as Record<string, string>;
              if (raw.speaker && raw.content) {
                turns.push({
                  speaker_skill_id: "",
                  speaker_name: raw.speaker,
                  turn_type: raw.type === "action" ? "action" : "dialogue",
                  content: raw.content,
                });
              }
            } catch { /* skip malformed */ }
            pos = i + 1;
            break;
          }
        }
      }
    }

    if (depth > 0) return { turns, remaining: buffer.slice(start) };
  }

  return { turns, remaining: buffer.slice(pos) };
}

export async function* btsGroupChat(
  session: BtsSession,
  presentSkills: SkillWithEntity[],
  user_message: string,
  signal?: AbortSignal,
): AsyncGenerator<BtsStreamChunk> {
  const appSettings = await db.app_settings.get("global");
  const s = getStrings(langFromStorage(appSettings?.ui_language));

  const nameToId = new Map<string, string>(
    presentSkills.map(({ skill, entity }) => [entity.canonical_name, skill.id]),
  );

  const performerDescs = presentSkills.map(({ skill, entity }) => {
    const parts: string[] = [entity.canonical_name];
    if (skill.off_set_persona?.casual_style) parts.push(`${s.bts_sys_casual(skill.off_set_persona.casual_style)}`);
    if (skill.off_set_persona?.quirks?.length) parts.push(`${s.bts_sys_quirks(skill.off_set_persona.quirks.join("、"))}`);
    return `- ${parts.join(" / ")}`;
  }).join("\n");

  const historyText = session.conversation_history.slice(-20).map(turn => {
    const name = turn.speaker_skill_id === "user"
      ? s.bts_you
      : turn.speaker_skill_id === "crew"
      ? s.bts_staff
      : (presentSkills.find(x => x.skill.id === turn.speaker_skill_id)?.entity.canonical_name ?? turn.speaker_skill_id);
    const prefix = turn.turn_type === "action" ? `*${turn.content}*` : turn.content;
    return `[${name}]: ${prefix}`;
  }).join("\n");

  const systemContent = s.bts_group_system(performerDescs, historyText);

  const client = await LlmClient.forRole("main");
  if (!client) throw new LlmError(0, "LLMが設定されていません。");

  let buffer = "";

  try {
    for await (const chunk of client.stream(
      [{ role: "system" as const, content: systemContent }, { role: "user" as const, content: user_message }],
      signal,
    )) {
      if (!chunk.delta) continue;
      buffer += chunk.delta;
      const { turns, remaining } = tryExtractObjects(buffer);
      buffer = remaining;
      for (const turn of turns) {
        turn.speaker_skill_id = nameToId.get(turn.speaker_name) ?? turn.speaker_name;
        yield { event: "turn_done", turn };
      }
    }
    // flush remaining
    const { turns } = tryExtractObjects(buffer);
    for (const turn of turns) {
      turn.speaker_skill_id = nameToId.get(turn.speaker_name) ?? turn.speaker_name;
      yield { event: "turn_done", turn };
    }
  } finally {
    await db.bts_sessions.update(session.id, { last_active: Date.now() });
  }

  yield { event: "all_done" };
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
    "場の雰囲気に合う短い一言を言ってください。1〜2文。キャラクター名・役者名・「俳優」「声優」という言葉は使わないこと。",
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

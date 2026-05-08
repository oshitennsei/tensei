import { LlmClient, LlmError } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { PerformanceSession, PerformanceMode, ImprovSetting, GeneratedSegment } from "@/lib/storage";

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
    // 9. Update last_active
    await db.performance_sessions.update(session.id, { last_active: Date.now() });
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

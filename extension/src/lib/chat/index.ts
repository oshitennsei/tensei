import { LlmClient } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { addTurn, buildSessionContext, sessionToMessages, getOrCreateSession, createNewSession } from "@/lib/memory";
import { buildContext } from "@/lib/retrieval";
import { buildReaderPersonaText } from "@/lib/persona";
import { checkInput, checkOutput, exceedsInputLimit, HARD_LIMITS } from "@/lib/content-safety";
import { db } from "@/lib/storage";
import type { Session, Turn } from "@/lib/storage";

async function extractRetrievalQuery(
  user_message: string,
  character_name: string,
  recent_turns: Turn[],
): Promise<string> {
  const subagent = await LlmClient.forRole("sub_agent");
  if (!subagent) return user_message;

  const context = recent_turns.slice(-4)
    .map(t => `${t.role === "user" ? "読者" : character_name}: ${t.content.slice(0, 100)}`)
    .join("\n");

  try {
    const result = await subagent.complete([
      {
        role: "system",
        content:
          "小説本文の検索クエリを生成します。会話から検索に有用なキーワード（人名・地名・出来事・感情・物品）を " +
          "原文の言語で抽出し、100文字以内で返してください。説明不要、キーワードのみ。",
      },
      {
        role: "user",
        content: [context, `読者: ${user_message}`].filter(Boolean).join("\n"),
      },
    ]);
    return result.trim() || user_message;
  } catch {
    return user_message;
  }
}

export interface ChatRequest {
  session: Session;
  user_message: string;
  signal?: AbortSignal;
}

export interface ChatError {
  type: "safety" | "limit" | "no_llm" | "llm_error";
  message: string;
}

export type ChatResponse =
  | { ok: true; stream: AsyncGenerator<string> }
  | { ok: false; error: ChatError };

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const { session, user_message, signal } = req;

  if (exceedsInputLimit(user_message)) {
    return { ok: false, error: { type: "limit", message: `入力は${HARD_LIMITS.max_input_chars}文字以内にしてください。` } };
  }
  if (session.tier_0_recent_turns.length >= HARD_LIMITS.max_turns_per_session) {
    return { ok: false, error: { type: "limit", message: "セッションの最大ターン数に達しました。新しいセッションを開始してください。" } };
  }

  const inputCheck = checkInput(user_message);
  if (!inputCheck.safe) {
    return { ok: false, error: { type: "safety", message: "そのメッセージは送信できません。" } };
  }

  const client = await LlmClient.forRole("main");
  if (!client) {
    return { ok: false, error: { type: "no_llm", message: "LLM APIが設定されていません。設定画面からAPIキーを入力してください。" } };
  }

  // Step 1: fetch character (needed for keyword extraction prompt)
  const [character, characterExt] = await Promise.all([
    db.entities.get(session.character_id),
    db.characters_extended.get(session.character_id),
  ]);

  // Step 2: keyword extraction + session/persona — all parallel
  const [ragQuery, sessionContext, personaText] = await Promise.all([
    extractRetrievalQuery(user_message, character?.canonical_name ?? "", session.tier_0_recent_turns),
    buildSessionContext(session),
    buildReaderPersonaText(session.work_id),
  ]);

  // Step 3: RAG with the improved query
  const ragContext = await buildContext(
    session.work_id, session.character_id, ragQuery,
    session.cutoff_chapter, session.character_version_id,
  );

  // Apply character version overrides for the system prompt
  const snapshot = session.character_version_id && session.character_version_id !== "base" && characterExt
    ? characterExt.state_snapshots.find(s => s.id === session.character_version_id)
    : undefined;
  const effectivePersona = snapshot?.persona_override ?? characterExt?.persona ?? "";
  const effectiveSpeechStyle = snapshot?.speech_style_override ?? characterExt?.speech_style;

  // Build character arc history from auto-generated snapshots up to cutoff
  function buildCharacterHistory(ext: typeof characterExt, cutoff: number, lang: string): string {
    if (!ext) return "";
    const relevant = ext.state_snapshots
      .filter(s => s.at_chapter != null && s.at_chapter <= cutoff && s.label && !s.is_selectable)
      .sort((a, b) => a.at_chapter - b.at_chapter);
    if (relevant.length === 0) return "";

    const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
    const header = isChinese
      ? `## 你截至目前的經歷與成長（第${cutoff}章為止）`
      : `## これまでの経緯と成長（第${cutoff}章まで）`;

    const lines = relevant.map(s => {
      const ch = isChinese ? `第${s.at_chapter}章` : `第${s.at_chapter}章`;
      const emotion = s.emotional_state ? `（情緒：${s.emotional_state}）` : "";
      const knowledge = s.knowledge?.length ? `\n  獲知：${s.knowledge.join("、")}` : "";
      const rels = s.relationships && Object.keys(s.relationships).length > 0
        ? `\n  關係變化：${Object.entries(s.relationships).map(([k, v]) => `${k}→${v}`).join("、")}`
        : "";
      return `- ${ch}：${s.label}${emotion}${knowledge}${rels}`;
    });

    return `${header}\n${lines.join("\n")}`;
  }

  const work = await db.works.get(session.work_id);
  const lang = work?.language ?? "ja";

  const systemParts: string[] = [];

  if (character && characterExt) {
    systemParts.push(
      `あなたは「${character.canonical_name}」というキャラクターです。`,
      effectivePersona,
    );
    if (effectiveSpeechStyle) systemParts.push(`話し方の特徴: ${effectiveSpeechStyle}`);

    const history = buildCharacterHistory(characterExt, session.cutoff_chapter, lang);
    if (history) systemParts.push(history);

    if (characterExt.voice_samples.length > 0) {
      const samples = characterExt.voice_samples.slice(0, 6).map(s =>
        s.context ? `【状況】${s.context}\n「${s.line}」` : `「${s.line}」`
      ).join("\n\n");
      systemParts.push(`## 典型的な話し方\n${samples}`);
    }
    if (characterExt.dialogue_examples && characterExt.dialogue_examples.length > 0) {
      const examples = characterExt.dialogue_examples.slice(0, 3).map(ex =>
        `状況: ${ex.context}\n読者: ${ex.user_message_pattern}\n${character!.canonical_name}: ${ex.ideal_response}`
      ).join("\n\n---\n\n");
      systemParts.push(`## 会話例\n${examples}`);
    }
    if (characterExt.will_do.length > 0) {
      systemParts.push("以下のことを積極的に行います:\n" + characterExt.will_do.map(d => `- ${d}`).join("\n"));
    }
    if (characterExt.will_not_do.length > 0) {
      systemParts.push("以下のことは絶対に行いません:\n" + characterExt.will_not_do.map(d => `- ${d}`).join("\n"));
    }
    if (characterExt.forbidden_topics.length > 0) {
      systemParts.push("以下のトピックには応答しません:\n" + characterExt.forbidden_topics.map(t => `- ${t}`).join("\n"));
    }
  }

  if (ragContext) systemParts.push(ragContext);
  if (sessionContext) systemParts.push(sessionContext);
  if (personaText) systemParts.push(personaText);

  systemParts.push(
    `現在の章数制限: 第${session.cutoff_chapter}章まで。それ以降の出来事は知りません。`,
    "キャラクターとして自然に会話してください。メタ的なコメントや「AIです」などの発言はしないでください。",
  );

  const messages: ChatMessage[] = [
    { role: "system", content: systemParts.join("\n\n") },
    ...sessionToMessages(session),
    { role: "user", content: user_message },
  ];

  await addTurn(session.id, { role: "user", content: user_message, timestamp: Date.now() });

  let accumulated = "";
  const stream = client.stream(messages, signal);

  async function* safeStream(): AsyncGenerator<string> {
    for await (const chunk of stream) {
      accumulated += chunk.delta;
      yield chunk.delta;
    }
    const outputCheck = checkOutput(accumulated);
    if (outputCheck.safe && accumulated) {
      await addTurn(session.id, { role: "character", content: accumulated, timestamp: Date.now() });
    }
  }

  return { ok: true, stream: safeStream() };
}

export { getOrCreateSession, createNewSession };

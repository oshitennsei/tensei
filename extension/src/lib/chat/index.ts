import { LlmClient } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { addTurn, buildSessionContext, sessionToMessages, getOrCreateSession, createNewSession } from "@/lib/memory";
import { buildContext } from "@/lib/retrieval";
import { buildReaderPersonaText } from "@/lib/persona";
import { checkInput, checkInputLLM, checkOutput, exceedsInputLimit, HARD_LIMITS } from "@/lib/content-safety";
import { db } from "@/lib/storage";
import type { Session, Turn, Language } from "@/lib/storage";
import { getStrings, langFromStorage } from "@/lib/i18n";

function parseOOC(message: string): { clean: string; direction: string | null } {
  const directions: string[] = [];
  const clean = message.replace(/\(([^)]+)\)/g, (_, inner) => {
    directions.push(inner.trim());
    return "";
  }).replace(/\s+/g, " ").trim();
  return { clean, direction: directions.length > 0 ? directions.join("\n") : null };
}

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

  // Phase 3: LLM-based moderation (optional — skipped if no sub_agent configured)
  const subagentForMod = await LlmClient.forRole("sub_agent");
  if (subagentForMod) {
    const llmCheck = await checkInputLLM(user_message, subagentForMod);
    if (!llmCheck.safe) {
      return { ok: false, error: { type: "safety", message: "そのメッセージは送信できません。" } };
    }
  }

  const client = await LlmClient.forRole("main");
  if (!client) {
    return { ok: false, error: { type: "no_llm", message: "LLM APIが設定されていません。設定画面からAPIキーを入力してください。" } };
  }

  // Step 1: fetch character + app settings in parallel
  const [character, characterExt, appSettings] = await Promise.all([
    db.entities.get(session.character_id),
    db.characters_extended.get(session.character_id),
    db.app_settings.get("global"),
  ]);

  const uiLang = (appSettings?.ui_language ?? "ja") as Language;
  const s = getStrings(langFromStorage(uiLang));
  const debugMode = appSettings?.plan_debug_mode ?? false;

  // Step 2: keyword extraction + session/persona — all parallel
  const [ragQuery, sessionContext, personaText] = await Promise.all([
    extractRetrievalQuery(user_message, character?.canonical_name ?? "", session.tier_0_recent_turns),
    buildSessionContext(session),
    buildReaderPersonaText(session.work_id),
  ]);

  // Reduce RAG chunk count when conversation has substantial history
  // (compression summaries mean context is already rich; novel chunks are less critical)
  const ragTopK = session.tier_1_paragraph_summaries.length > 0 ? 2 : 5;

  // Step 3: RAG with the improved query
  const ragContext = await buildContext(
    session.work_id, session.character_id, ragQuery,
    session.cutoff_chapter, session.character_version_id,
    uiLang, ragTopK,
  );

  // Apply character version overrides for the system prompt
  const snapshot = session.character_version_id && session.character_version_id !== "base" && characterExt
    ? characterExt.state_snapshots.find(snap => snap.id === session.character_version_id)
    : undefined;
  const effectivePersona = snapshot?.persona_override ?? characterExt?.persona ?? "";
  const effectiveSpeechStyle = snapshot?.speech_style_override ?? characterExt?.speech_style;

  // Build character arc history from auto-generated snapshots up to cutoff
  function buildCharacterHistory(ext: typeof characterExt, cutoff: number): string {
    if (!ext) return "";
    const relevant = ext.state_snapshots
      .filter(snap => snap.at_chapter != null && snap.at_chapter <= cutoff && snap.label && !snap.is_selectable)
      .sort((a, b) => a.at_chapter - b.at_chapter);
    if (relevant.length === 0) return "";

    const header = s.chat_char_history_header(cutoff);

    const lines = relevant.map(snap => {
      const ch = `第${snap.at_chapter}章`;
      const emotion = snap.emotional_state ? `（情緒：${snap.emotional_state}）` : "";
      const knowledge = snap.knowledge?.length ? `\n  獲知：${snap.knowledge.join("、")}` : "";
      const rels = snap.relationships && Object.keys(snap.relationships).length > 0
        ? `\n  關係変化：${Object.entries(snap.relationships).map(([k, v]) => `${k}→${v}`).join("、")}`
        : "";
      return `- ${ch}：${snap.label}${emotion}${knowledge}${rels}`;
    });

    return `${header}\n${lines.join("\n")}`;
  }

  const glossary = await db.work_glossaries.get(session.work_id);

  const systemParts: string[] = [];

  if (character && characterExt) {
    systemParts.push(
      s.chat_char_intro(character.canonical_name),
      effectivePersona,
    );
    if (effectiveSpeechStyle) systemParts.push(`${s.chat_speech_style_prefix}${effectiveSpeechStyle}`);

    const history = buildCharacterHistory(characterExt, session.cutoff_chapter);
    if (history) systemParts.push(history);

    if (characterExt.voice_samples.length > 0) {
      const samples = characterExt.voice_samples.slice(0, 6).map(vs =>
        vs.context ? `【状況】${vs.context}\n「${vs.line}」` : `「${vs.line}」`
      ).join("\n\n");
      systemParts.push(`${s.chat_voice_samples_header}\n${samples}`);
    }
    if (characterExt.dialogue_examples && characterExt.dialogue_examples.length > 0) {
      const examples = characterExt.dialogue_examples.slice(0, 3).map(ex =>
        `${s.chat_example_context}${ex.context}\n${s.chat_example_reader_label}${ex.user_message_pattern}\n${character!.canonical_name}: ${ex.ideal_response}`
      ).join("\n\n---\n\n");
      systemParts.push(`${s.chat_dialogue_examples_header}\n${examples}`);
    }
    if (characterExt.will_do.length > 0) {
      systemParts.push(`${s.chat_will_do_header}\n` + characterExt.will_do.map(d => `- ${d}`).join("\n"));
    }
    if (characterExt.will_not_do.length > 0) {
      systemParts.push(`${s.chat_will_not_do_header}\n` + characterExt.will_not_do.map(d => `- ${d}`).join("\n"));
    }
    if (characterExt.forbidden_topics.length > 0) {
      systemParts.push(`${s.chat_forbidden_topics_header}\n` + characterExt.forbidden_topics.map(t => `- ${t}`).join("\n"));
    }
  }

  if (glossary && glossary.entries.length > 0 && uiLang !== "ja") {
    const table = glossary.entries
      .filter(e => e.translations[uiLang])
      .map(e => `- ${e.original} → ${e.translations[uiLang]}`)
      .join("\n");
    if (table) systemParts.push(`${s.chat_glossary_header}\n${table}`);
  }

  if (ragContext) systemParts.push(ragContext);
  if (sessionContext) systemParts.push(sessionContext);
  if (personaText) systemParts.push(personaText);

  // Parse OOC direction from user message — inject into prompt, store clean version
  const { clean: cleanMessage, direction: oocDirection } = parseOOC(user_message);
  if (oocDirection) systemParts.push(`${s.chat_ooc_direction_header}\n${oocDirection}`);

  systemParts.push(
    s.chat_chapter_limit(session.cutoff_chapter),
    s.chat_instruction,
  );

  const messages: ChatMessage[] = [
    { role: "system", content: systemParts.join("\n\n") },
    ...sessionToMessages(session),
    { role: "user", content: cleanMessage || user_message },
  ];

  // Store the raw message (with OOC) so the UI can display the annotation
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
      const charTurn: Turn = { role: "character", content: accumulated, timestamp: Date.now() };
      if (debugMode) charTurn.debug_prompt = systemParts.join("\n\n");
      await addTurn(session.id, charTurn);
    }
  }

  return { ok: true, stream: safeStream() };
}

export { getOrCreateSession, createNewSession };

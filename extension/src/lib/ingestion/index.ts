import { db } from "@/lib/storage";
import type { Work, Chapter, Chunk, Entity, CharacterExtended } from "@/lib/storage";
import { LlmClient, LlmError, getModelForRole } from "@/lib/llm";
import { getEmbedder } from "@/lib/embedding";

const EMBED_BATCH_SIZE = 64;

// ── Multi-pass analysis helpers ───────────────────────────────────────────────

type PassType = "single" | "intermediate" | "final";

function getBlockSize(contextWindow?: number): number {
  // Reserve ~4000 tokens for prompt + known chars; 1.5 CJK chars per token
  const effective = (contextWindow ?? 32000) - 4000;
  return Math.min(Math.max(Math.floor(effective / 1.5), 4000), 40000);
}

function splitIntoBlocks(text: string, blockSize: number): string[] {
  if (text.length <= blockSize) return [text];
  const overlap = Math.floor(blockSize * 0.03); // 3% overlap at boundaries
  const blocks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + blockSize, text.length);
    if (end < text.length) {
      const br = text.lastIndexOf("。", end);
      if (br > start + blockSize * 0.6) end = br + 1;
      else {
        const brEn = text.lastIndexOf(". ", end);
        if (brEn > start + blockSize * 0.6) end = brEn + 1;
        else {
          const brNl = text.lastIndexOf("\n", end);
          if (brNl > start + blockSize * 0.6) end = brNl + 1;
        }
      }
    }
    blocks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - overlap;
  }
  return blocks.filter(b => b.length > 0);
}

interface AccumulatedAnalysis {
  characters: Array<{ name: string; aliases: string[]; description: string; is_main: boolean }>;
  items: string[];
  key_events: string[];
  character_updates: CharacterUpdate[];
}

function mergeAccumulated(acc: AccumulatedAnalysis, next: Partial<AnalysisResult>): AccumulatedAnalysis {
  const charMap = new Map(acc.characters.map(c => [c.name.toLowerCase(), { ...c }]));
  for (const c of next.characters ?? []) {
    if (!c.name) continue;
    const key = c.name.toLowerCase();
    const existing = charMap.get(key);
    if (existing) {
      const newAliases = (c.aliases ?? []).filter(a => !existing.aliases.includes(a));
      if (newAliases.length) existing.aliases = [...existing.aliases, ...newAliases];
      if (!existing.description && c.description) existing.description = c.description;
    } else {
      charMap.set(key, { ...c, aliases: c.aliases ?? [] });
    }
  }

  const events = [...acc.key_events];
  for (const e of next.key_events ?? []) if (!events.includes(e)) events.push(e);

  const itemSet = new Set(acc.items);
  for (const item of next.items ?? []) itemSet.add(item);

  const updateMap = new Map(acc.character_updates.map(u => [u.name.toLowerCase(), { ...u }]));
  for (const u of next.character_updates ?? []) {
    if (!u.name || !u.state_note) continue;
    const key = u.name.toLowerCase();
    const existing = updateMap.get(key);
    if (existing) {
      existing.state_note = [existing.state_note, u.state_note].filter(Boolean).join("；");
      if (u.emotional_state) existing.emotional_state = u.emotional_state;
      existing.knowledge_gained = [...(existing.knowledge_gained ?? []), ...(u.knowledge_gained ?? [])];
      existing.relationship_changes = { ...existing.relationship_changes, ...u.relationship_changes };
    } else {
      updateMap.set(key, { ...u });
    }
  }

  return {
    characters: [...charMap.values()],
    items: [...itemSet],
    key_events: events,
    character_updates: [...updateMap.values()],
  };
}

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 80;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const breakAt = text.lastIndexOf("。", end);
      if (breakAt > start + CHUNK_SIZE / 2) end = breakAt + 1;
      else {
        const breakEn = text.lastIndexOf(". ", end);
        if (breakEn > start + CHUNK_SIZE / 2) end = breakEn + 1;
      }
    }
    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter(c => c.length > 0);
}

// Extract JSON block from LLM response that may contain prose around it
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return JSON.parse(fence[1].trim());
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) return JSON.parse(brace[1]);
  return JSON.parse(text.trim());
}

interface CharacterUpdate {
  name: string;
  state_note: string;
  emotional_state?: string;
  knowledge_gained?: string[];
  relationship_changes?: Record<string, string>;
}

interface AnalysisResult {
  summaries: { ultra: string; short: string; medium: string };
  characters: Array<{ name: string; aliases: string[]; description: string; is_main: boolean }>;
  items: string[];
  key_events: string[];
  character_updates?: CharacterUpdate[];
}

function formatKnownChars(entities: Entity[], lang: string): string {
  if (entities.length === 0) return "";
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
  const aliasLabel = isChinese ? "別稱" : lang === "ko" ? "별명" : "別名";
  const descLabel  = isChinese ? "說明" : lang === "ko" ? "설명" : "説明";
  const chLabel    = isChinese ? "初登場" : lang === "ko" ? "첫등장" : "初登場";

  const lines = entities.slice(0, 80).map(e => {
    const aliasPart = e.aliases.length ? `（${aliasLabel}：${e.aliases.join("、")}）` : "";
    const descPart  = e.description ? `\n  ${descLabel}：${e.description.slice(0, 120)}` : "";
    const chPart    = e.first_appearance != null ? `  ${chLabel}：第${e.first_appearance}章` : "";
    // For dot-separated foreign names, extract likely surname as a hint
    const nameParts = e.canonical_name.split(/[·•]/);
    const surname = nameParts.length > 1 ? nameParts[nameParts.length - 1].trim() : "";
    const surnamePart = surname.length >= 2 ? `（簡稱可能是：${surname}）` : "";
    return `- ${e.canonical_name}${surnamePart}${aliasPart}${chPart}${descPart}`;
  }).join("\n");

  if (isChinese) {
    return `\n\n## 已知角色（請勿重複建立）
以下角色已在系統中登錄。本章若出現以下任一情況，請使用完全相同的 name，不要建立新角色：
① 名字完全相同或只差繁簡字形（乔=喬、瀬=瀨、戸=戶）
② 是已知角色的姓氏或暱稱（如「索科洛夫」對應「伊凡·維克托羅維奇·索科洛夫」）
③ 是同一外語名的不同語言音譯（如ジョシュア=喬舒亞=Joshua）
④ 人物事蹟、職務、關係與已知角色吻合（即使稱呼不同）
本章使用的其他稱呼請加入 aliases，不要另立條目。
${lines}`;
  }
  if (lang === "en") {
    return `\n\n## Known Characters (do NOT create duplicates)
Match a character in this chapter to a known character if ANY of these apply:
① Same name or variant spelling  ② Surname or nickname of a known character
③ Same foreign name transliterated differently  ④ Same background/role/story
Use the exact same name; add the new form to aliases.
${lines}`;
  }
  if (lang === "ko") {
    return `\n\n## 기존 등장인물 (중복 생성 금지)
다음 중 하나라도 해당하면 기존 캐릭터로 처리하세요:
① 이름이 같거나 한자 변형 ② 성만 사용 ③ 같은 외래어 이름의 다른 표기 ④ 배경/역할이 동일
${lines}`;
  }
  return `\n\n## 既知のキャラクター（重複作成禁止）
以下のいずれかに該当する場合は既存キャラクターとして扱ってください：
① 名前が同じまたは字体の違い ② 既知キャラの苗字・愛称のみ ③ 同一外国名の別言語表記 ④ 経歴・役職が一致
同じ name を使い、別の呼び方は aliases に追加してください。
${lines}`;
}

function buildAnalysisPrompt(
  chapter: Chapter,
  lang: string,
  knownEntities: Entity[],
  blockText: string,
  passType: PassType = "single",
  accumulatedEvents: string[] = [],
): { system: string; user: string } {
  const excerpt = blockText;
  const knownBlock = formatKnownChars(knownEntities, lang);
  const isIntermediate = passType === "intermediate";
  const isFinal = passType === "final";

  const accEventsBlock = isFinal && accumulatedEvents.length > 0
    ? `\n\n【前段已發現的事件 — 請在全章摘要中涵蓋這些內容】\n${accumulatedEvents.map(e => `- ${e}`).join("\n")}`
    : "";
  const accEventsBlockEn = isFinal && accumulatedEvents.length > 0
    ? `\n\n[Events found in earlier segments — include these in the chapter summary]\n${accumulatedEvents.map(e => `- ${e}`).join("\n")}`
    : "";
  const accEventsBlockJa = isFinal && accumulatedEvents.length > 0
    ? `\n\n【前のブロックで発見されたイベント — 章全体の要約にこれらを含めること】\n${accumulatedEvents.map(e => `- ${e}`).join("\n")}`
    : "";

  const summariesSchemaZh = isIntermediate ? "" : `  "summaries": {
    "ultra": "約50字的超短摘要${isFinal ? "（涵蓋全章）" : ""}",
    "short": "約200字的短摘要${isFinal ? "（涵蓋全章）" : ""}",
    "medium": "500~800字的中摘要${isFinal ? "（涵蓋全章所有事件）" : ""}"
  },
`;
  const summariesSchemaEn = isIntermediate ? "" : `  "summaries": {
    "ultra": "~50 char ultra-short summary${isFinal ? " (covering entire chapter)" : ""}",
    "short": "~200 char short summary${isFinal ? " (covering entire chapter)" : ""}",
    "medium": "500-800 char medium summary${isFinal ? " (covering all chapter events)" : ""}"
  },
`;
  const summariesSchemaJa = isIntermediate ? "" : `  "summaries": {
    "ultra": "約50文字の超短要約${isFinal ? "（章全体を網羅）" : ""}",
    "short": "約200文字の短要約${isFinal ? "（章全体を網羅）" : ""}",
    "medium": "500〜800文字の中要約${isFinal ? "（全イベントを網羅）" : ""}"
  },
`;
  const intermediateNote = isIntermediate
    ? "\n【注意】這是多段解析的中間段，請勿生成 summaries，只提取人物與事件。"
    : "";
  const intermediateNoteEn = isIntermediate
    ? "\n[Note] This is an intermediate segment in a multi-pass analysis. Do NOT generate summaries. Only extract characters and events."
    : "";
  const intermediateNoteJa = isIntermediate
    ? "\n【注意】これは分割解析の中間ブロックです。summaries は生成しないでください。キャラクターとイベントの抽出のみ行ってください。"
    : "";

  if (lang === "zh-tw" || lang === "zh-cn" || lang === "zh") {
    const langLabel = lang === "zh-tw" ? "繁體中文" : lang === "zh-cn" ? "简体中文" : "中文";
    return {
      system: `你是一位小說分析專家。請只以指定的JSON格式回答，所有摘要及說明請使用${langLabel}，不要有任何其他說明。`,
      user: `請分析以下小說章節段落，返回JSON格式結果。${knownBlock}${intermediateNote}${accEventsBlock}

章節標題: ${chapter.title}
內文:
${excerpt}

請返回以下JSON格式（所有文字請用${langLabel}）:
{
${summariesSchemaZh}  "characters": [
    {
      "name": "角色的主要稱呼（不含括號說明或翻譯；與已知角色清單完全一致）",
      "aliases": ["本段對同一人使用的另一個名字（暱稱、代號、化名、姓名省略形）"],
      "description": "角色說明（100字以內）",
      "is_main": false
    }
  ],
  "items": ["重要道具名稱"],
  "key_events": ["重要事件說明"],
  "character_updates": [
    {
      "name": "角色名稱（與characters中一致）",
      "state_note": "本段此角色的重要變化或成長（50字以內）",
      "emotional_state": "本段末尾的情緒狀態",
      "knowledge_gained": ["本段新獲得的重要認知或資訊"],
      "relationship_changes": { "其他角色名": "關係變化描述" }
    }
  ]
}

【aliases 填寫規則 — 非常重要】
✓ 可以填：暱稱、代號（如「蜈蚣」）、化名、姓名省略（如「悠」是「桐生悠」的省略）
✗ 嚴格禁止：職稱（教授、主任）、職業描述（資安人員）、人際關係（男友、父親）、括號內翻譯、描述性詞語
✗ 若某名字可能屬於不同的角色，請各自建立條目，不要合併

【character_updates 填寫規則】
✓ 列入：有重大事件的角色（重要決定、情感轉折、身份揭露、關係改變、獲得重要資訊）
✗ 不列入：只是出場、只有日常對話、沒有重大事件的角色
若本段無重大角色事件，請返回空陣列 []`,
    };
  }

  if (lang === "en") {
    return {
      system: "You are a literary analyst. Return only the specified JSON format. All summaries and descriptions must be in English.",
      user: `Analyze the following novel chapter segment and return a JSON result.${knownBlock}${intermediateNoteEn}${accEventsBlockEn}

Chapter title: ${chapter.title}
Text:
${excerpt}

Return this JSON format (all text in English):
{
${summariesSchemaEn}  "characters": [
    {
      "name": "Character's primary name (no parenthetical explanations; match known characters exactly)",
      "aliases": ["another name used for this same person in this segment"],
      "description": "Character description (under 100 words)",
      "is_main": false
    }
  ],
  "items": ["important item name"],
  "key_events": ["important event description"],
  "character_updates": [
    {
      "name": "character name (matching characters list)",
      "state_note": "significant change or growth this segment (under 50 words)",
      "emotional_state": "emotional state at end of segment",
      "knowledge_gained": ["important new knowledge gained"],
      "relationship_changes": { "other character name": "how the relationship changed" }
    }
  ]
}

[aliases rules]
✓ Include: nicknames, code names, aliases, shortened name forms
✗ Exclude: titles, job descriptions, relationship labels, parenthetical translations
✗ If unsure whether a name belongs to the same person, create separate entries

[character_updates rules]
✓ Include: key decision, emotional shift, identity reveal, relationship change, important revelation
✗ Exclude: characters who only appear briefly with no significant event
Return [] if no character has a significant event`,
    };
  }

  if (lang === "ko") {
    return {
      system: "당신은 소설 분석 전문가입니다. 지정된 JSON 형식만 반환하고 모든 내용은 한국어로 작성하세요.",
      user: `다음 소설 챕터를 분석하고 JSON 결과를 반환하세요.${knownBlock}${isIntermediate ? "\n[참고] 중간 단락입니다. summaries 없이 인물과 이벤트만 추출하세요." : ""}

챕터 제목: ${chapter.title}
본문:
${excerpt}

다음 JSON 형식으로 반환하세요:
{
${isIntermediate ? "" : `  "summaries": {
    "ultra": "약 50자 초단 요약",
    "short": "약 200자 단 요약",
    "medium": "500~800자 중간 요약"
  },
`}  "characters": [
    {
      "name": "공식 전체 이름 (기존 캐릭터와 정확히 일치)",
      "aliases": ["이 단락에서 사용된 별명, 코드명, 가명"],
      "description": "캐릭터 설명",
      "is_main": true
    }
  ],
  "items": ["중요 아이템"],
  "key_events": ["중요 사건"]
}`,
    };
  }

  // Default: Japanese
  return {
    system: "あなたは小説分析の専門家です。指定されたJSON形式のみで返答してください。",
    user: `以下の小説の章（またはブロック）を分析し、必ずJSON形式のみで返してください。余計な説明は不要です。${knownBlock}${intermediateNoteJa}${accEventsBlockJa}

章タイトル: ${chapter.title}
本文:
${excerpt}

返すJSONの形式:
{
${summariesSchemaJa}  "characters": [
    {
      "name": "正式名（全名・既知キャラと完全一致させること）",
      "aliases": ["このブロックで使われた別名・ニックネーム・コードネーム・変装名"],
      "description": "キャラクターの説明",
      "is_main": true
    }
  ],
  "items": ["重要アイテム名"],
  "key_events": ["重要なイベントの説明"],
  "character_updates": [
    {
      "name": "キャラクター名（charactersリストと一致）",
      "state_note": "このブロックでのそのキャラの重要な変化・成長（50文字以内）",
      "emotional_state": "このブロックの終わりの感情状態",
      "knowledge_gained": ["このブロックで得た重要な情報・認識"],
      "relationship_changes": { "他キャラ名": "関係の変化" }
    }
  ]
}

【character_updates ルール】
✓ 記録する：重要な決断・感情の変化・正体の発覚・関係の変化・重要情報の取得
✗ 記録しない：登場するだけ・日常会話のみ・重大なイベントなし
重大な変化がない場合は []`,
  };
}

// Single LLM call for one block of text
async function llmAnalyzeBlock(
  chapter: Chapter,
  lang: string,
  knownEntities: Entity[],
  blockText: string,
  passType: PassType,
  accumulatedEvents: string[],
  client: InstanceType<typeof LlmClient>,
): Promise<Partial<AnalysisResult> | null> {
  const { system, user } = buildAnalysisPrompt(
    chapter, lang, knownEntities, blockText, passType, accumulatedEvents,
  );
  const raw = await client.complete([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  try {
    return extractJson(raw) as Partial<AnalysisResult>;
  } catch {
    return null;
  }
}

async function llmAnalyze(
  chapter: Chapter,
  onBlockProgress?: (block: number, total: number) => void,
): Promise<AnalysisResult | null> {
  const [client, model] = await Promise.all([
    LlmClient.forRole("main"),
    getModelForRole("main"),
  ]);
  if (!client) return null;

  const [work, knownEntities] = await Promise.all([
    db.works.get(chapter.work_id),
    db.entities.where("work_id").equals(chapter.work_id).filter(e => e.type === "character").toArray(),
  ]);
  const lang = work?.language ?? "ja";
  const blockSize = getBlockSize(model?.context_window);
  const blocks = splitIntoBlocks(chapter.full_text, blockSize);

  if (blocks.length === 1) {
    const result = await llmAnalyzeBlock(chapter, lang, knownEntities, blocks[0], "single", [], client);
    return result as AnalysisResult | null;
  }

  // Multi-pass: accumulate across blocks
  let acc: AccumulatedAnalysis = { characters: [], items: [], key_events: [], character_updates: [] };
  let lastSummaries: AnalysisResult["summaries"] = { ultra: "", short: "", medium: "" };

  for (let i = 0; i < blocks.length; i++) {
    onBlockProgress?.(i + 1, blocks.length);
    const passType: PassType = i === blocks.length - 1 ? "final" : "intermediate";
    const result = await llmAnalyzeBlock(
      chapter, lang, knownEntities, blocks[i], passType, acc.key_events, client,
    );
    if (!result) continue;
    acc = mergeAccumulated(acc, result);
    if (passType === "final" && result.summaries) lastSummaries = result.summaries;
  }

  return {
    summaries: lastSummaries,
    characters: acc.characters,
    items: acc.items,
    key_events: acc.key_events,
    character_updates: acc.character_updates,
  };
}

export type AnalysisStatus = "idle" | "chunking" | "analyzing" | "saving" | "embedding" | "done" | "no_llm" | "error";
export type AnalysisError = { message: string } | null;

export interface IngestWorkInput {
  title: string;
  author: string;
  language: Work["language"];
  platform: Work["platform"];
  source_type: Work["source_type"];
}

export async function getOrCreateWork(input: IngestWorkInput): Promise<Work> {
  const existing = await db.works
    .where("title").equals(input.title)
    .filter(w => w.author === input.author)
    .first();
  if (existing) return existing;
  const work: Work = { id: crypto.randomUUID(), last_updated: Date.now(), ...input };
  await db.works.add(work);
  return work;
}

export interface IngestChapterInput {
  work_id: string;
  chapter_number: number;
  title: string;
  full_text: string;
}

export async function ingestChapter(input: IngestChapterInput): Promise<Chapter> {
  const existing = await db.chapters
    .where("[work_id+chapter_number]")
    .equals([input.work_id, input.chapter_number])
    .first();

  const chapter_id = existing?.id ?? crypto.randomUUID();
  const textChunks = chunkText(input.full_text);

  const chunks: Chunk[] = textChunks.map((text, i) => ({
    id: crypto.randomUUID(),
    chapter_id,
    position: i,
    text,
    characters_present: [],
    events: [],
    items: [],
    content_tags: [],
  }));

  const chapter: Chapter = {
    id: chapter_id,
    work_id: input.work_id,
    chapter_number: input.chapter_number,
    title: input.title,
    full_text: input.full_text,
    summary_ultra: "",
    summary_short: "",
    summary_medium: "",
    appearing_characters: [],
    mentioned_characters: [],
    mentioned_items: [],
    key_events: [],
    chunk_ids: chunks.map(c => c.id),
  };

  await db.transaction("rw", [db.chapters, db.chunks], async () => {
    if (existing) {
      await db.chunks.where("chapter_id").equals(chapter_id).delete();
      await db.chapters.put(chapter);
    } else {
      await db.chapters.add(chapter);
    }
    await db.chunks.bulkAdd(chunks);
  });

  return chapter;
}

export async function analyzeChapter(
  chapter: Chapter,
  onStatus?: (s: AnalysisStatus) => void,
  onError?: (msg: string) => void,
  onBlockProgress?: (block: number, total: number) => void,
): Promise<void> {
  onStatus?.("analyzing");
  let result: AnalysisResult | null;
  try {
    result = await llmAnalyze(chapter, onBlockProgress);
  } catch (e) {
    const msg = e instanceof LlmError ? e.userMessage : String(e);
    onError?.(msg);
    onStatus?.("error");
    return;
  }

  if (!result) {
    onStatus?.("no_llm");
    return;
  }

  onStatus?.("saving");

  const existingEntities = await db.entities.where("work_id").equals(chapter.work_id).toArray();

  // Build lookup map by canonical name AND all aliases
  const entityByKey = new Map<string, Entity>();
  for (const e of existingEntities) {
    entityByKey.set(e.canonical_name.toLowerCase(), e);
    for (const alias of e.aliases) {
      entityByKey.set(alias.toLowerCase(), e);
    }
  }

  const appearing_ids: string[] = [];

  for (const char of result.characters ?? []) {
    if (!char.name) continue;
    const key = char.name.toLowerCase();
    let entity = entityByKey.get(key);

    if (!entity) {
      entity = {
        id: crypto.randomUUID(),
        work_id: chapter.work_id,
        type: "character",
        canonical_name: char.name,
        aliases: char.aliases ?? [],
        description: char.description ?? "",
        parent_entities: [],
        child_entities: [],
        first_appearance: chapter.chapter_number,
        key_appearances: [chapter.chapter_number],
        linked_entities: [],
      };
      await db.entities.add(entity);
      // Register under canonical name and all aliases
      entityByKey.set(key, entity);
      for (const alias of entity.aliases) {
        entityByKey.set(alias.toLowerCase(), entity);
      }

      if (char.is_main) {
        const ext: CharacterExtended = {
          id: entity.id,
          work_id: chapter.work_id,
          persona: char.description ?? "",
          voice_samples: [],
          will_do: [],
          will_not_do: [],
          forbidden_topics: [],
          state_snapshots: [],
          author_provided: false,
        };
        await db.characters_extended.add(ext);
      }
    } else {
      // Merge new aliases from this chapter into existing entity
      const newAliases = (char.aliases ?? []).filter(
        a => a && a.toLowerCase() !== entity!.canonical_name.toLowerCase() && !entity!.aliases.includes(a)
      );
      // Also register char.name as alias if it doesn't match the canonical name
      if (entity.canonical_name.toLowerCase() !== key && !entity.aliases.map(a => a.toLowerCase()).includes(key)) {
        newAliases.push(char.name);
      }

      const updates: Partial<Entity> = {};
      if (newAliases.length > 0) {
        updates.aliases = [...entity.aliases, ...newAliases];
        for (const a of newAliases) entityByKey.set(a.toLowerCase(), entity);
      }
      if (!entity.key_appearances.includes(chapter.chapter_number)) {
        updates.key_appearances = [...entity.key_appearances, chapter.chapter_number];
      }
      if (Object.keys(updates).length > 0) {
        await db.entities.update(entity.id, updates);
        Object.assign(entity, updates);
      }
    }

    appearing_ids.push(entity.id);
  }

  await db.chapters.update(chapter.id, {
    summary_ultra: result.summaries?.ultra ?? "",
    summary_short: result.summaries?.short ?? "",
    summary_medium: result.summaries?.medium ?? "",
    appearing_characters: appearing_ids,
    mentioned_items: result.items ?? [],
    key_events: result.key_events ?? [],
  });

  // Embed chapter summary for faster chapter-level retrieval
  const summaryForEmbedding = result.summaries?.short ?? "";
  if (summaryForEmbedding) {
    const embedder = await getEmbedder();
    if (embedder) {
      try {
        const [emb] = await embedder([summaryForEmbedding]);
        await db.chapters.update(chapter.id, { embedding_summary: emb });
      } catch {}
    }
  }

  // Process character state updates (auto snapshots)
  for (const update of result.character_updates ?? []) {
    if (!update.name || !update.state_note) continue;
    const entity = entityByKey.get(update.name.toLowerCase());
    if (!entity) continue;

    let ext = await db.characters_extended.get(entity.id);
    if (!ext) {
      ext = {
        id: entity.id,
        work_id: chapter.work_id,
        persona: entity.description ?? "",
        voice_samples: [],
        will_do: [],
        will_not_do: [],
        forbidden_topics: [],
        state_snapshots: [],
        author_provided: false,
      };
      await db.characters_extended.add(ext);
    } else if (!ext.persona && entity.description) {
      await db.characters_extended.update(entity.id, { persona: entity.description });
      ext.persona = entity.description;
    }

    // Upsert snapshot for this chapter (avoid duplicates on re-analysis)
    const existingIdx = ext.state_snapshots.findIndex(s => s.at_chapter === chapter.chapter_number);
    const snapshot: import("@/lib/storage").CharacterStateSnapshot = {
      id: existingIdx >= 0 ? ext.state_snapshots[existingIdx].id : crypto.randomUUID(),
      label: update.state_note,
      at_chapter: chapter.chapter_number,
      from_chapter: chapter.chapter_number,
      is_selectable: false,
      emotional_state: update.emotional_state ?? "",
      knowledge: update.knowledge_gained ?? [],
      relationships: update.relationship_changes ?? {},
    };

    const snapshots = [...ext.state_snapshots];
    if (existingIdx >= 0) snapshots[existingIdx] = snapshot;
    else snapshots.push(snapshot);

    await db.characters_extended.update(entity.id, { state_snapshots: snapshots });
  }

  // Compute chunk embeddings (best-effort; silent skip if no embedding client)
  onStatus?.("embedding");
  await embedChapter(chapter.id).catch(() => {});

  onStatus?.("done");
}

export async function embedChapter(chapter_id: string): Promise<void> {
  const embedder = await getEmbedder();
  if (!embedder) return;

  const chunks = await db.chunks.where("chapter_id").equals(chapter_id).toArray();
  if (chunks.length === 0) return;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedder(batch.map(c => c.text));
    await Promise.all(
      batch.map((chunk, j) => db.chunks.update(chunk.id, { embedding: embeddings[j] }))
    );
  }
}

export async function ingestPastedText(
  work_id: string,
  chapter_number: number,
  title: string,
  full_text: string,
  onStatus?: (s: AnalysisStatus) => void,
  onError?: (msg: string) => void,
): Promise<Chapter> {
  onStatus?.("chunking");
  const chapter = await ingestChapter({ work_id, chapter_number, title, full_text });
  await analyzeChapter(chapter, onStatus, onError);
  return chapter;
}

// ── Entity resolution ─────────────────────────────────────────────────────────

async function mergeEntities(canonical_id: string, duplicate_ids: string[]): Promise<void> {
  const canonical = await db.entities.get(canonical_id);
  if (!canonical) return;

  const duplicates = (await Promise.all(duplicate_ids.map(id => db.entities.get(id)))).filter(Boolean) as Entity[];
  if (duplicates.length === 0) return;

  // Merge all aliases from duplicates into canonical
  const mergedAliases = new Set(canonical.aliases);
  for (const dup of duplicates) {
    mergedAliases.add(dup.canonical_name);
    for (const a of dup.aliases) mergedAliases.add(a);
  }
  mergedAliases.delete(canonical.canonical_name);
  const mergedAppearances = [...new Set([...canonical.key_appearances, ...duplicates.flatMap(d => d.key_appearances)])].sort((a, b) => a - b);
  const firstAppearance = Math.min(canonical.first_appearance ?? Infinity, ...duplicates.map(d => d.first_appearance ?? Infinity));

  await db.entities.update(canonical_id, {
    aliases: [...mergedAliases],
    key_appearances: mergedAppearances,
    first_appearance: isFinite(firstAppearance) ? firstAppearance : canonical.first_appearance,
  });

  const dupIdSet = new Set(duplicate_ids);

  // Update chapters: replace duplicate IDs with canonical ID
  const chapters = await db.chapters.where("work_id").equals(canonical.work_id).toArray();
  for (const ch of chapters) {
    const updates: Partial<Chapter> = {};
    if (ch.appearing_characters.some(id => dupIdSet.has(id))) {
      updates.appearing_characters = [...new Set(ch.appearing_characters.map(id => dupIdSet.has(id) ? canonical_id : id))];
    }
    if (ch.mentioned_characters.some(id => dupIdSet.has(id))) {
      updates.mentioned_characters = [...new Set(ch.mentioned_characters.map(id => dupIdSet.has(id) ? canonical_id : id))];
    }
    if (Object.keys(updates).length > 0) await db.chapters.update(ch.id, updates);
  }

  // CharacterExtended: move if canonical has none but a duplicate does
  const canonExt = await db.characters_extended.get(canonical_id);
  if (!canonExt) {
    for (const dup of duplicates) {
      const dupExt = await db.characters_extended.get(dup.id);
      if (dupExt) {
        await db.characters_extended.add({ ...dupExt, id: canonical_id });
        break;
      }
    }
  }
  for (const dup of duplicates) {
    await db.characters_extended.delete(dup.id);
    await db.entities.delete(dup.id);
  }
}

export async function resolveEntities(
  work_id: string,
  onProgress?: (status: string) => void,
  onError?: (msg: string) => void,
): Promise<number> {
  const client = await LlmClient.forRole("sub_agent") ?? await LlmClient.forRole("main");
  if (!client) { onError?.("LLMが設定されていません。"); return 0; }

  const entities = await db.entities.where("work_id").equals(work_id)
    .filter(e => e.type === "character").toArray();
  if (entities.length < 2) return 0;

  const work = await db.works.get(work_id);
  const lang = work?.language ?? "ja";
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";

  // Use sequential numbers — LLMs handle numbers far better than UUIDs
  const list = entities.map((e, i) => {
    const aliasPart = e.aliases.length ? `  別名:${e.aliases.slice(0, 5).join(" / ")}` : "";
    const chPart = e.first_appearance != null ? `  [Ch.${e.first_appearance}]` : "";
    const descPart = e.description ? `\n   └ ${e.description.slice(0, 80)}` : "";
    return `#${i + 1}  ${e.canonical_name}${aliasPart}${chPart}${descPart}`;
  }).join("\n");

  const systemPrompt = isChinese
    ? "你是小說人物同定專家。請仔細找出同一個人的不同寫法，只返回JSON，不要任何說明。"
    : "小説キャラクター同定の専門家です。同一人物の異なる表記のみJSON形式で返してください。説明不要。";

  const userPrompt = isChinese
    ? `以下是從小說中提取的角色清單（附說明）。請找出「確定是同一個人物」的不同條目並分組。

【必須識別的模式】
1. 全名 vs 姓/名/暱稱：「村上浩二」=「村上」=「村上教授」（共享姓氏）
2. 括號內是家族姓氏：「悠（桐生）」=「桐生悠」（桐生是姓）
3. 括號內是羅馬字注音：「高橋（Takahashi）」=「高橋誠司」
4. 括號只是翻譯：「蜈蚣」=「蜈蚣（Centipede）」
5. 姓名長短：「索科洛夫」=「伊凡·維克托羅維奇·索科洛夫」（點分隔名的末段是姓）
6. 繁簡字形：「乔舒亚」=「喬舒亞」、「瀬戸」=「瀨戶」（乔=喬, 瀬=瀨, 戸=戶）
7. 跨語言音譯：「ジョシュア」=「喬舒亞」=「Joshua」（日文片假名 vs 中文音譯）
8. 說明欄相同職務/組織 → 強烈提示為同一人

【合併原則】
- 只有高度確信是同一個人時才合併，寧可保守
- keep 請選擇姓名最完整的那個編號

角色清單（[Ch.N] 為初登場章節，└ 為說明）：
${list}

返回JSON陣列：
[
  { "keep": 4, "merge": [3, 7], "reason": "村上浩二是全名，村上/村上教授是簡稱" }
]
沒有重複時返回空陣列 []。`
    : `以下は小説から抽出されたキャラクターリストです（説明付き）。同一人物のみを特定してください。

【識別すべきパターン】
1. フルネーム vs 姓・名のみ ／ 称号+姓
2. 括弧内が苗字：「悠（桐生）」=「桐生悠」
3. 括弧内がローマ字読み ／ 英訳のみ
4. 名前の省略：「ソコロフ」=「イワン・ヴィクトロヴィチ・ソコロフ」（点区切り名の最末尾が姓）
5. 字体ゆれ：「乔舒亚」=「喬舒亞」（簡体字・繁体字）
6. 多言語音写：「ジョシュア」=「喬舒亞」（片仮名↔中国語）
7. 説明欄の職務・組織が同じ → 同一人物の可能性大

【マージ原則】高い確信がある場合のみ。keepは最もフルネームに近い番号。

キャラクターリスト（[Ch.N] は初登場章、└ は説明）：
${list}

JSONで返してください：
[
  { "keep": 4, "merge": [3, 7], "reason": "村上浩二がフルネーム" }
]
重複なし: []`;

  onProgress?.(isChinese ? "LLM 分析角色重複中..." : "LLMで人物同定中...");

  let groups: Array<{ keep: number; merge: number[]; reason: string }>;
  try {
    const raw = await client.complete([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    groups = extractJson(raw) as typeof groups;
    if (!Array.isArray(groups)) groups = [];
  } catch (e) {
    onError?.(String(e));
    return 0;
  }

  let merged = 0;
  for (const g of groups) {
    // Convert 1-indexed numbers to 0-indexed
    const keepIdx = (g.keep ?? 0) - 1;
    if (keepIdx < 0 || keepIdx >= entities.length) continue;
    const mergeIdxs = (g.merge ?? [])
      .map((n: number) => n - 1)
      .filter((n: number) => n >= 0 && n < entities.length && n !== keepIdx);
    if (mergeIdxs.length === 0) continue;

    const canonical = entities[keepIdx];
    const dupIds = mergeIdxs.map((i: number) => entities[i].id);
    onProgress?.(isChinese ? `合併: ${canonical.canonical_name}` : `マージ: ${canonical.canonical_name}`);
    await mergeEntities(canonical.id, dupIds);
    merged += dupIds.length;
  }
  return merged;
}

type BatchProgressFn = (done: number, total: number, current: string) => void;

export async function generateMissingPersonas(
  work_id: string,
  onProgress?: BatchProgressFn,
  onError?: (msg: string) => void,
): Promise<number> {
  const client = await LlmClient.forRole("main");
  if (!client) { onError?.("LLMが設定されていません。"); return 0; }

  const work = await db.works.get(work_id);
  const lang = work?.language ?? "ja";
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";

  const [entities, exts] = await Promise.all([
    db.entities.where("work_id").equals(work_id).filter(e => e.type === "character").toArray(),
    db.characters_extended.where("work_id").equals(work_id).toArray(),
  ]);
  const extMap = new Map(exts.map(e => [e.id, e]));

  const needPersona = entities.filter(e => {
    const ext = extMap.get(e.id);
    return !ext || !ext.persona;
  });
  if (needPersona.length === 0) return 0;

  const allChapters = await db.chapters.where("work_id").equals(work_id).sortBy("chapter_number");

  let count = 0;
  for (let i = 0; i < needPersona.length; i++) {
    const entity = needPersona[i];
    onProgress?.(i, needPersona.length, entity.canonical_name);

    const appearingChapters = allChapters
      .filter(ch => ch.appearing_characters.includes(entity.id))
      .slice(0, 8);

    const chapterContext = appearingChapters
      .map(ch => `第${ch.chapter_number}章：${ch.summary_short || ch.summary_ultra || ""}`.slice(0, 200))
      .join("\n");

    if (!entity.description && !chapterContext) continue;

    const prompt = isChinese
      ? `請根據以下資料，為小說角色「${entity.canonical_name}」撰寫角色扮演用的人物設定（100〜200字）。
說明：${entity.description || "（無）"}
出場章節：
${chapterContext || "（無）"}

請用${lang === "zh-tw" ? "繁體中文" : "简体中文"}描述：①個性與行為模式 ②說話風格及語氣 ③對話時對讀者的態度
只寫以上三點，不要標題或編號。`
      : `以下の情報をもとに「${entity.canonical_name}」のロールプレイ用ペルソナを100〜200文字で書いてください。
説明: ${entity.description || "（なし）"}
登場章:
${chapterContext || "（なし）"}

①性格・行動パターン ②話し方の特徴 ③読者への態度 をまとめて記述。見出し不要。`;

    try {
      const persona = await client.complete([{ role: "user", content: prompt }]);
      const trimmed = persona.trim();
      const ext = extMap.get(entity.id);
      if (ext) {
        await db.characters_extended.update(entity.id, { persona: trimmed });
        ext.persona = trimmed;
      } else {
        const newExt: CharacterExtended = {
          id: entity.id, work_id,
          persona: trimmed, voice_samples: [],
          will_do: [], will_not_do: [], forbidden_topics: [],
          state_snapshots: [], author_provided: false,
        };
        await db.characters_extended.add(newExt);
        extMap.set(entity.id, newExt);
      }
      count++;
    } catch (e) {
      onError?.(String(e));
    }
  }
  onProgress?.(needPersona.length, needPersona.length, "");
  return count;
}

export async function reanalyzeWork(
  work_id: string,
  onProgress?: BatchProgressFn,
  onError?: (msg: string) => void,
  onBlockProgress?: (block: number, total: number) => void,
): Promise<void> {
  const chapters = await listChapters(work_id);
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.(i, chapters.length, chapters[i].title);
    onBlockProgress?.(0, 0); // reset block progress for new chapter
    await analyzeChapter(chapters[i], undefined, onError, onBlockProgress).catch(e => onError?.(String(e)));
  }
  onProgress?.(chapters.length, chapters.length, "");
}

export async function reembedWork(
  work_id: string,
  onProgress?: BatchProgressFn,
  onError?: (msg: string) => void,
): Promise<void> {
  const embedder = await getEmbedder();
  if (!embedder) {
    onError?.("Embeddingモデルが設定されていません。設定画面からEmbedding用のAPIキーとモデル名を入力してください。");
    return;
  }
  const chapters = await listChapters(work_id);
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.(i, chapters.length, chapters[i].title);
    await embedChapter(chapters[i].id).catch(e => onError?.(String(e)));
  }
  onProgress?.(chapters.length, chapters.length, "");
}

export async function listWorks(): Promise<Work[]> {
  return db.works.toArray();
}

export async function listChapters(work_id: string): Promise<Chapter[]> {
  return db.chapters.where("work_id").equals(work_id).sortBy("chapter_number");
}

export async function deleteWork(work_id: string): Promise<void> {
  const chapters = await db.chapters.where("work_id").equals(work_id).toArray();
  const chapter_ids = chapters.map(c => c.id);
  await db.transaction("rw", [db.works, db.chapters, db.chunks, db.entities, db.events, db.sessions], async () => {
    for (const cid of chapter_ids) {
      await db.chunks.where("chapter_id").equals(cid).delete();
    }
    await db.chapters.where("work_id").equals(work_id).delete();
    await db.entities.where("work_id").equals(work_id).delete();
    await db.sessions.where("work_id").equals(work_id).delete();
    await db.works.delete(work_id);
  });
}

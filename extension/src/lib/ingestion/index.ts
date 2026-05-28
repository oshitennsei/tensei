import { db } from "@/lib/storage";
import type { Work, Chapter, Chunk, Entity, CharacterExtended, EntityExtended, EntityStateSnapshot, Language, Event, EventOccurrence, EventParticipant } from "@/lib/storage";
import { LlmClient, LlmError, getModelForRole } from "@/lib/llm";
import { getEmbedder } from "@/lib/embedding";

const EMBED_BATCH_SIZE = 64;

// Detect source language from text sample using character range heuristics
function detectLanguage(text: string): Language {
  const sample = text.slice(0, 2000);
  let hiragana = 0, katakana = 0, hangul = 0, cjk = 0, nonAscii = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x3040 && cp <= 0x309F) hiragana++;
    else if (cp >= 0x30A0 && cp <= 0x30FF) katakana++;
    else if (cp >= 0xAC00 && cp <= 0xD7AF) hangul++;
    else if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) cjk++;
    if (cp > 0x7F) nonAscii++;
  }
  if (nonAscii < 5) return "en";
  if (hangul > 5) return "ko";
  if (hiragana + katakana > 10) return "ja";
  if (cjk > 10) return "zh";
  return "en";
}

// ── Multi-pass / block helpers ────────────────────────────────────────────────

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
  events: RawEventResult[];
  entity_updates: RawEntityUpdate[];
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

  // Merge events: dedup by `what` text (case-insensitive)
  const eventMap = new Map(acc.events.map(e => [e.what.toLowerCase(), { ...e }]));
  for (const e of next.events ?? []) {
    if (!e.what) continue;
    const key = e.what.toLowerCase();
    if (!eventMap.has(key)) {
      eventMap.set(key, { ...e });
    } else {
      // Append note if different
      const existing = eventMap.get(key)!;
      if (e.note && e.note !== existing.note) {
        existing.note = [existing.note, e.note].filter(Boolean).join("；");
      }
    }
  }

  // Merge entity_updates (location/item) — last occurrence wins per name per chapter
  const entityUpdateMap = new Map(acc.entity_updates.map(u => [u.name.toLowerCase(), { ...u }]));
  for (const u of next.entity_updates ?? []) {
    if (!u.name || !u.state_note) continue;
    entityUpdateMap.set(u.name.toLowerCase(), { ...u });
  }

  return {
    characters: [...charMap.values()],
    items: [...itemSet],
    key_events: events,
    character_updates: [...updateMap.values()],
    events: [...eventMap.values()],
    entity_updates: [...entityUpdateMap.values()],
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

interface RawEntityUpdate {
  name: string;
  type: "location" | "item";
  state_note: string;      // ≤300 chars: what changed
  controller?: string;     // locations: who controls/occupies it
  holder?: string;         // items: who possesses it
  status?: string;
}

interface RawEventResult {
  what: string;           // short event label ≤50 chars
  who: string[];          // character names involved
  where?: string;
  when?: string;
  why?: string;
  how?: string;
  consequences?: string[];
  note: string;           // per-chapter description ≤300 chars
}

interface AnalysisResult {
  summaries: { ultra: string; short: string; medium: string };
  characters: Array<{ name: string; type?: Entity["type"]; aliases: string[]; description: string; is_main: boolean }>;
  items: string[];
  key_events: string[];
  character_updates?: CharacterUpdate[];
  events?: RawEventResult[];
  entity_updates?: RawEntityUpdate[];
}

// ── Phase 1: Entity context building ─────────────────────────────────────────

interface ContextEntity {
  entity_id: string;
  canonical_name: string;
  aliases: string[];
  type: Entity["type"];
  first_appearance?: number;
  latest_status?: string;
}

function fmtCtxEntity(e: ContextEntity): string {
  const prefix = e.type === "character" ? "[P]" : e.type === "location" ? "[L]" : "[I]";
  const aliasPart = e.aliases.length > 0 ? `（${e.aliases.slice(0, 3).join("・")}）` : "";
  const statusPart = e.latest_status ? `: ${e.latest_status.slice(0, 60)}` : "";
  const chapterPart = e.first_appearance != null ? ` 第${e.first_appearance}章〜` : "";
  return `${prefix} ${e.canonical_name}${aliasPart}${chapterPart}${statusPart}`;
}

async function buildCandidateEntities(chapter: Chapter): Promise<ContextEntity[]> {
  const allEntities = await db.entities.where("work_id").equals(chapter.work_id).toArray();
  const textLower = chapter.full_text.toLowerCase();

  const matched = allEntities.filter(e => {
    const names = [e.canonical_name, ...e.aliases].filter(n => n.length >= 2);
    return names.some(n => textLower.includes(n.toLowerCase()));
  });

  if (matched.length === 0) return [];

  const charIds = matched.filter(e => e.type === "character").map(e => e.id);
  const exts = await db.characters_extended.bulkGet(charIds);
  const extMap = new Map<string, CharacterExtended>();
  for (const ext of exts) if (ext) extMap.set(ext.id, ext);

  return matched.map(e => {
    const ext = extMap.get(e.id);
    const latestSnap = (ext?.state_snapshots ?? [])
      .filter(s => s.at_chapter <= chapter.chapter_number)
      .sort((a, b) => b.at_chapter - a.at_chapter)[0];
    return {
      entity_id: e.id,
      canonical_name: e.canonical_name,
      aliases: e.aliases,
      type: e.type,
      first_appearance: e.first_appearance,
      latest_status: latestSnap?.label?.slice(0, 60),
    };
  });
}

interface Phase1Output {
  confirmed: ContextEntity[];
  new_names: string[];
  alias_matched: Array<{ text_name: string; canonical: string }>;
}

async function llmPhase1Filter(
  chapter: Chapter,
  candidates: ContextEntity[],
  client: InstanceType<typeof LlmClient>,
): Promise<Phase1Output> {
  const textSample = chapter.full_text.slice(0, 4000);
  const candidateList = candidates.map(fmtCtxEntity).join("\n");

  const system = `You are a literary entity recognition expert. Identify which known entities appear in the chapter, including those referred to by shortened names or aliases. Return JSON only.`;
  const user = `## Known Entities (in DB)
${candidateList}

## Chapter text (beginning)
${textSample}

Return:
{
  "confirmed": ["canonical_name"],
  "alias_matched": [{"text_name": "name used in text", "canonical": "full canonical name from DB"}],
  "new_names": ["name not matching any known entity"]
}

Rules:
- Put in alias_matched if a text name is a surname, given name, shortened form, or common alias of a known entity — use linguistic understanding, not string matching
- If the same shortened name could refer to two different people (e.g. father and son sharing a surname), include both if context shows both appear
- Only add to new_names if confident it is genuinely a new entity not in the DB`;

  try {
    const raw = await client.complete([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const parsed = extractJson(raw) as {
      confirmed?: string[];
      alias_matched?: Array<{ text_name: string; canonical: string }>;
      new_names?: string[];
    };
    const confirmedNames = new Set((parsed.confirmed ?? []).map(n => n.toLowerCase()));
    for (const am of parsed.alias_matched ?? []) {
      if (am.canonical) confirmedNames.add(am.canonical.toLowerCase());
    }
    const confirmed = candidates.filter(e =>
      confirmedNames.has(e.canonical_name.toLowerCase()) ||
      e.aliases.some(a => confirmedNames.has(a.toLowerCase()))
    );
    const alias_matched = (parsed.alias_matched ?? []).filter(am => am.text_name && am.canonical);
    return {
      confirmed,
      new_names: (parsed.new_names ?? []).filter(n => n && n.length >= 2),
      alias_matched,
    };
  } catch {
    return { confirmed: candidates, new_names: [], alias_matched: [] };
  }
}

// ── Phase 2: Domain-parallel analysis (single-language prompts) ───────────────

type Domain = "characters" | "events" | "locations_items" | "summary";

function buildDomainSystem(): string {
  return `You are a literary analyst. Per the task instruction, return only the requested JSON with no explanation. Output all text values (summaries, descriptions, notes, labels) in the SAME language as the input novel text.`;
}

function buildDomainUserPrefix(
  chapter: Chapter,
  confirmedEntities: ContextEntity[],
  newEntityNames: string[],
  blockText: string,
): string {
  const knownSection = confirmedEntities.length > 0
    ? `## Known Entities\n${confirmedEntities.map(fmtCtxEntity).join("\n")}`
    : "";
  const newSection = newEntityNames.length > 0
    ? `## New Entities\n${newEntityNames.join(", ")}`
    : "";
  const chapterHeader = `## Chapter ${chapter.chapter_number}: ${chapter.title}`;
  return [knownSection, newSection, chapterHeader, blockText].filter(Boolean).join("\n\n");
}

function buildDomainTask(domain: Domain, isFinalBlock: boolean, accEventLabels: string[]): string {
  const accEventsBlock = domain === "summary" && isFinalBlock && accEventLabels.length > 0
    ? `\n\nEvents identified in earlier blocks:\n${accEventLabels.map(e => `- ${e}`).join("\n")}`
    : "";

  switch (domain) {
    case "characters":
      return `\n\n## Task: New Entities & Character Updates

NEW entities (those in "New Entities" or not present in "Known Entities"):
- Output a full entry. Set "type" to: "character", "organization", "location", or "item".
- In "aliases", include ALL ways this entity may be referred to: surname alone, given name alone, shortened forms, nicknames, common informal references. Use your linguistic understanding of the name — do NOT rely on punctuation or length.
- Do NOT create entities for titles or roles (Admiral, Professor, Commander, etc.). A title-based reference to a known entity should appear in character_updates, not as a new entity.

KNOWN entities (in "Known Entities"):
- Output character_updates only. state_note ≤200 words. No re-description.

{"characters":[{"name":"canonical full name","type":"character","aliases":["surname","given name","nickname",...],"description":"≤300 words","is_main":false}],
 "character_updates":[{"name":"canonical name from Known Entities","state_note":"≤200 words","emotional_state":"...","knowledge_gained":[...],"relationship_changes":{"name":"..."}}]}

Return characters:[] if no new entities. Return character_updates:[] if no significant changes.`;

    case "events":
      return `\n\n## Task: Major Events
Record only major plot events (up to 5): deaths/injuries, battles, secret reveals, betrayals/alliances, decisive turning points.
Exclude: casual conversation, travel, routine meetings.

{"events":[{"what":"≤50-char label","who":["character names"],"where":"location","when":"relative timing in chapter","why":"cause/motivation","how":"means/circumstances","consequences":["1-3 outcomes"],"note":"concrete description ≤200 words"}]}

Return {"events":[]} if no major events.`;

    case "locations_items":
      return `\n\n## Task: Locations & Items
(1) List names of important items/objects newly introduced or prominently featured in this chapter.
(2) For any location or item in "Known Entities" (or mentioned in the text) that undergoes a clear state change — captured, destroyed, transferred, renamed, activated, sealed, broken, stolen, recovered, etc. — record it in entity_updates. Use the exact canonical name from "Known Entities" if it matches, otherwise use the name as it appears in the text.

{"items":["item name"],
 "entity_updates":[{"name":"exact name from Known Entities or text","type":"item","state_note":"≤200 chars: what changed and who caused it","controller":"who controls/occupies (locations only)","holder":"who now possesses it (items only)","status":"current state summary"}]}

Return empty arrays if nothing notable.`;

    case "summary":
      if (!isFinalBlock) return "";
      return `\n\n## Task: Chapter Summary${accEventsBlock}
Write summaries covering the ENTIRE chapter (not just this final segment).

{"summaries":{"ultra":"~50 chars: one-line gist","short":"~200 chars: key plot beats","medium":"500-800 chars: full chapter overview"},"key_events":["brief label for each major event"]}`;
  }
}

// Thrown when a chapter fails all retries — signals the batch to stop immediately.
export class AnalysisFatalError extends Error {
  readonly cause?: unknown;
  constructor(public readonly chapterTitle: string, cause?: unknown) {
    super(`3回連続解析失敗: ${chapterTitle}`);
    this.name = "AnalysisFatalError";
    this.cause = cause;
  }
}

const MAX_ANALYSIS_RETRIES = 3;

// Single domain LLM call — retries up to MAX_ANALYSIS_RETRIES times.
async function llmDomainCall(
  sharedSystem: string,
  sharedPrefix: string,
  domain: Domain,
  isFinalBlock: boolean,
  accEventLabels: string[],
  client: InstanceType<typeof LlmClient>,
  chapterTitle: string,
): Promise<Partial<AnalysisResult>> {
  const task = buildDomainTask(domain, isFinalBlock, accEventLabels);
  if (!task) return {};

  const userMsg = sharedPrefix + task;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ANALYSIS_RETRIES; attempt++) {
    try {
      const raw = await client.complete([
        { role: "system", content: sharedSystem },
        { role: "user", content: userMsg },
      ]);
      return extractJson(raw) as Partial<AnalysisResult>;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_ANALYSIS_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw new AnalysisFatalError(chapterTitle, lastError);
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

  const detected = detectLanguage(chapter.full_text);
  const work = await db.works.get(chapter.work_id);
  if (work && work.language !== detected) {
    await db.works.update(work.id, { language: detected });
  }

  // Phase 1: text-match candidates, then LLM disambiguation for characters only.
  // Non-character entities (locations/items/orgs) use text-match directly — they lack
  // the alias ambiguity that makes LLM confirmation necessary for characters, and
  // LLM phase 1 uses only the first 4000 chars which misses later-chapter state changes.
  const candidates = await buildCandidateEntities(chapter);
  const charCandidates = candidates.filter(e => e.type === "character");
  const nonCharCandidates = candidates.filter(e => e.type !== "character");

  const phase1 = charCandidates.length > 5
    ? await llmPhase1Filter(chapter, charCandidates, client)
    : { confirmed: charCandidates, new_names: [], alias_matched: [] };
  const { confirmed: confirmedChars, new_names: newEntityNames, alias_matched } = phase1;

  // Merge: LLM-confirmed characters + all text-matched non-characters
  const seenInPhase1 = new Set(confirmedChars.map(e => e.entity_id));
  const confirmedEntities = [
    ...confirmedChars,
    ...nonCharCandidates.filter(e => !seenInPhase1.has(e.entity_id)),
  ];

  // Build map: canonical → new alias text_names to propagate to analyzeChapter
  const aliasAdditions = new Map<string, string[]>();
  for (const am of alias_matched) {
    const key = am.canonical.toLowerCase();
    if (!aliasAdditions.has(key)) aliasAdditions.set(key, []);
    aliasAdditions.get(key)!.push(am.text_name);
  }

  // Phase 2: parallel domain sessions per block
  const blockSize = getBlockSize(model?.context_window);
  const blocks = splitIntoBlocks(chapter.full_text, blockSize);
  const sharedSystem = buildDomainSystem();

  let acc: AccumulatedAnalysis = {
    characters: [], items: [], key_events: [],
    character_updates: [], events: [], entity_updates: [],
  };
  let lastSummaries: AnalysisResult["summaries"] = { ultra: "", short: "", medium: "" };

  for (let i = 0; i < blocks.length; i++) {
    onBlockProgress?.(i + 1, blocks.length);
    const isFinalBlock = i === blocks.length - 1;
    const sharedPrefix = buildDomainUserPrefix(chapter, confirmedEntities, newEntityNames, blocks[i]);
    const domains: Domain[] = isFinalBlock
      ? ["characters", "events", "locations_items", "summary"]
      : ["characters", "events", "locations_items"];

    const accEventLabels = acc.events.map(e => e.what).filter(Boolean);

    // AnalysisFatalError from any domain propagates — batch stops immediately
    const results = await Promise.all(
      domains.map(d => llmDomainCall(
        sharedSystem, sharedPrefix, d,
        isFinalBlock, accEventLabels, client, chapter.title,
      ))
    );

    const blockResult: Partial<AnalysisResult> = Object.assign({}, ...results);
    acc = mergeAccumulated(acc, blockResult);
    if (isFinalBlock && blockResult.summaries) lastSummaries = blockResult.summaries;
  }

  if (acc.key_events.length === 0 && acc.events.length > 0) {
    acc.key_events = acc.events.map(e => e.what).filter(Boolean);
  }

  // Add confirmed known entities as stubs so analyzeChapter() tracks appearances.
  // Include any alias_matched text_names so analyzeChapter() registers them as new aliases.
  const resultCharNames = new Set(acc.characters.map(c => c.name.toLowerCase()));
  for (const e of confirmedEntities) {
    if (e.type === "character" && !resultCharNames.has(e.canonical_name.toLowerCase())) {
      const newAliases = aliasAdditions.get(e.canonical_name.toLowerCase()) ?? [];
      acc.characters.push({ name: e.canonical_name, aliases: newAliases, description: "", is_main: false });
    }
  }

  return {
    summaries: lastSummaries,
    characters: acc.characters,
    items: acc.items,
    key_events: acc.key_events,
    character_updates: acc.character_updates,
    events: acc.events,
    entity_updates: acc.entity_updates,
  };
}

export type AnalysisStatus = "idle" | "chunking" | "analyzing" | "saving" | "profile_update" | "embedding" | "done" | "no_llm" | "error";
export type AnalysisError = { message: string } | null;

export interface IngestWorkInput {
  title: string;
  author: string;
  language: Work["language"];
  platform: Work["platform"];
  source_type: Work["source_type"];
  platform_url?: string;
}

export async function getOrCreateWork(input: IngestWorkInput): Promise<Work> {
  // If a platform_url is given, prefer matching by it (for authorized imports)
  if (input.platform_url) {
    const byUrl = await db.works.filter(w => w.platform_url === input.platform_url).first();
    if (byUrl) return byUrl;
  }
  const existing = await db.works
    .where("title").equals(input.title)
    .filter(w => w.author === input.author)
    .first();
  if (existing) {
    // Back-fill platform_url if missing
    if (input.platform_url && !existing.platform_url) {
      await db.works.update(existing.id, { platform_url: input.platform_url });
      existing.platform_url = input.platform_url;
    }
    return existing;
  }
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

// Language-aware system message for KV cache reuse across all chapter calls
function getProfileUpdateSystem(lang: string): string {
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
  if (isChinese) {
    return `你是小說角色扮演專用的角色資料更新專家。\n根據章節文本描述與現有資料，更新登場角色的角色資料。\n每個角色需生成以下內容：\n- persona: 400～500字。①性格與行動模式 ②價值觀與信念 ③過去經歷與現狀 ④與讀者的互動態度。如有現有資料，請結合本章描述進行更新\n- speech_style: 50～100字。語調、語尾、口頭禪、情感表達模式，請具體描述\n- new_voice_samples: 直接引用本章文本中的台詞3～5句（脫離前後文也能理解者）\n請只以JSON格式回答，不需要說明或前言。`;
  }
  if (lang === "en") {
    return `You are an expert at updating roleplay character profiles for novel characters.\nBased on the chapter text and existing profile information, update character profiles for appearing characters.\nFor each character, generate:\n- persona: 400-500 words. Include ①personality and behavior ②values and beliefs ③background and current situation ④reader interaction style. If existing, update based on this chapter.\n- speech_style: 50-100 words. Speech patterns, characteristic endings, verbal tics, emotional expression.\n- new_voice_samples: 3-5 direct quotes from this chapter (quotes that make sense without context)\nRespond in JSON format only. No explanations.`;
  }
  if (lang === "ko") {
    return `당신은 소설 캐릭터의 롤플레이용 프로필 업데이트 전문가입니다.\n챕터 텍스트 묘사와 기존 프로필 정보를 바탕으로 등장 캐릭터의 프로필을 업데이트하세요.\n각 캐릭터에 대해 다음을 생성하세요:\n- persona: 400~500자. ①성격과 행동 패턴 ②가치관과 신념 ③과거 경위와 현재 상황 ④독자에 대한 태도. 기존이 있으면 이번 챕터 묘사를 반영하여 업데이트\n- speech_style: 50~100자. 말투, 어미, 말버릇, 감정 표현 패턴을 구체적으로\n- new_voice_samples: 이번 챕터 텍스트에서 직접 인용한 대사 3~5개\nJSON 형식으로만 답변하세요.`;
  }
  // Default: Japanese
  return `あなたは小説キャラクターのロールプレイ用プロファイル更新の専門家です。\n与えられた章のテキスト描写と既存のプロファイル情報をもとに、登場キャラクターのプロファイルを更新・補完してください。\n各キャラクターについて以下を生成してください：\n- persona: 400〜500文字。①性格と行動パターン ②価値観と信念 ③過去の経緯と現在の状況 ④読者への態度を含むこと。既存がある場合は本章の描写を加味して更新する\n- speech_style: 50〜100文字。口調・語尾・言葉の癖・感情表現パターンを具体的に\n- new_voice_samples: 本章テキストから引用した台詞3〜5つ（文脈なしで意味が通るもの）\nJSON形式のみで返答してください。説明や前置きは不要です。`;
}

function buildCharBlock(entity: Entity, ext: CharacterExtended | undefined, chunkText: string, lang: string): string {
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
  const isEn = lang === "en";
  const personaVal = ext?.persona?.slice(0, 200) ?? "";
  const speechVal = ext?.speech_style?.slice(0, 100) ?? "";
  const descVal = entity.description?.slice(0, 200) ?? "";
  if (isChinese) {
    return (
      `【${entity.canonical_name}】\n` +
      `現有persona: ${personaVal || "（未設定）"}\n` +
      `現有speech_style: ${speechVal || "（未設定）"}\n` +
      `基本說明: ${descVal || "（無）"}\n` +
      `本章描述:\n${chunkText || "（無）"}`
    );
  }
  if (isEn) {
    return (
      `[${entity.canonical_name}]\n` +
      `Current persona: ${personaVal || "(not set)"}\n` +
      `Current speech_style: ${speechVal || "(not set)"}\n` +
      `Description: ${descVal || "(none)"}\n` +
      `Chapter depiction:\n${chunkText || "(none)"}`
    );
  }
  // Default: Japanese
  return (
    `【${entity.canonical_name}】\n` +
    `現在のpersona: ${personaVal || "（未設定）"}\n` +
    `現在のspeech_style: ${speechVal || "（未設定）"}\n` +
    `基本説明: ${descVal || "（なし）"}\n` +
    `本章での描写:\n${chunkText || "（なし）"}`
  );
}

function buildProfileUpdateUser(chapter: Chapter, lang: string, charList: string, charBlocks: string[]): string {
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
  const isEn = lang === "en";
  const blocksJoined = charBlocks.join("\n\n");
  if (isChinese) {
    return (
      `第${chapter.chapter_number}章「${chapter.title}」登場角色: ${charList}\n\n` +
      blocksJoined +
      `\n\n請只以JSON格式回答:\n{"updates":[{"name":"角色名","persona":"...","speech_style":"...","new_voice_samples":["台詞1","台詞2"]}]}`
    );
  }
  if (isEn) {
    return (
      `Chapter ${chapter.chapter_number} "${chapter.title}" — Appearing characters: ${charList}\n\n` +
      blocksJoined +
      `\n\nRespond in JSON format only:\n{"updates":[{"name":"character name","persona":"...","speech_style":"...","new_voice_samples":["line1","line2"]}]}`
    );
  }
  // Default: Japanese
  return (
    `第${chapter.chapter_number}章「${chapter.title}」登場キャラクター: ${charList}\n\n` +
    blocksJoined +
    `\n\nJSON形式のみで返答:\n{"updates":[{"name":"キャラ名","persona":"...","speech_style":"...","new_voice_samples":["セリフ1","セリフ2"]}]}`
  );
}

async function updateCharacterProfilesStep2(
  chapter: Chapter,
  result: AnalysisResult,
  entityByKey: Map<string, Entity>,
  lang: string,
): Promise<void> {
  const client = await LlmClient.forRole("sub_agent") ?? await LlmClient.forRole("main");
  if (!client) return;

  const appearingEntities: Entity[] = [];
  for (const char of result.characters ?? []) {
    if (!char.name) continue;
    const entity = entityByKey.get(char.name.toLowerCase());
    if (entity) appearingEntities.push(entity);
  }
  if (appearingEntities.length === 0) return;

  const extIds = appearingEntities.map(e => e.id);
  const exts = await db.characters_extended.bulkGet(extIds);
  const extMap = new Map<string, CharacterExtended>();
  for (const ext of exts) {
    if (ext) extMap.set(ext.id, ext);
  }

  const allChunks = await db.chunks.where("chapter_id").equals(chapter.id).sortBy("position");

  const charBlocks: string[] = [];
  for (const entity of appearingEntities) {
    const ext = extMap.get(entity.id);

    let charChunks = allChunks.filter(c => c.characters_present.includes(entity.id)).slice(0, 3);
    if (charChunks.length === 0) {
      const kw = entity.canonical_name.slice(0, 4).toLowerCase();
      charChunks = allChunks.filter(c => c.text.toLowerCase().includes(kw)).slice(0, 3);
    }
    const chunkTextStr = charChunks.map(c => c.text.slice(0, 500)).join("\n---\n");

    charBlocks.push(buildCharBlock(entity, ext, chunkTextStr, lang));
  }

  const charList = appearingEntities.map(e => e.canonical_name).join("、");
  const userMsg = buildProfileUpdateUser(chapter, lang, charList, charBlocks);

  let raw: string;
  try {
    raw = await client.complete([
      { role: "system", content: getProfileUpdateSystem(lang) },
      { role: "user", content: userMsg },
    ]);
  } catch {
    return;
  }

  let parsed: { updates?: Array<{ name?: string; persona?: string; speech_style?: string; new_voice_samples?: string[] }> };
  try {
    parsed = extractJson(raw) as typeof parsed;
  } catch {
    return;
  }

  for (const upd of parsed.updates ?? []) {
    if (!upd.name) continue;
    const entity = entityByKey.get(upd.name.toLowerCase());
    if (!entity) continue;

    const updates: Partial<CharacterExtended> = {};
    if (upd.persona) updates.persona = upd.persona;
    if (upd.speech_style) updates.speech_style = upd.speech_style;
    if (upd.new_voice_samples && upd.new_voice_samples.length > 0) {
      const ext = extMap.get(entity.id);
      const chapterLabel = `第${chapter.chapter_number}章`;
      const kept = (ext?.voice_samples ?? []).filter(s => s.context !== chapterLabel);
      const newSamples = upd.new_voice_samples.map(line => ({ context: chapterLabel, line }));
      updates.voice_samples = [...kept, ...newSamples].slice(-8);
    }

    if (extMap.has(entity.id)) {
      await db.characters_extended.update(entity.id, updates);
    } else {
      const newExt: CharacterExtended = {
        id: entity.id,
        work_id: chapter.work_id,
        persona: updates.persona ?? "",
        speech_style: updates.speech_style,
        voice_samples: updates.voice_samples ?? [],
        will_do: [],
        will_not_do: [],
        forbidden_topics: [],
        state_snapshots: [],
        author_provided: false,
      };
      await db.characters_extended.add(newExt);
    }
  }
}

export async function analyzeChapter(
  chapter: Chapter,
  onStatus?: (s: AnalysisStatus) => void,
  onError?: (msg: string) => void,
  onBlockProgress?: (block: number, total: number) => void,
): Promise<void> {
  onStatus?.("analyzing");

  const work = await db.works.get(chapter.work_id);
  // Always detect from text — work.language may be a stale initial value (e.g. "ja" hardcoded at ingest)
  const lang = detectLanguage(chapter.full_text);
  if (work && work.language !== lang) {
    await db.works.update(work.id, { language: lang });
  }

  let result: AnalysisResult | null;
  try {
    result = await llmAnalyze(chapter, onBlockProgress);
  } catch (e) {
    if (e instanceof AnalysisFatalError) throw e; // let batch handler catch this
    const msg = e instanceof LlmError ? e.userMessage : String(e);
    onError?.(msg);
    onStatus?.("error");
    return;
  }

  if (!result) {
    onError?.(`「${chapter.title}」の解析に失敗しました（LLM未設定またはレスポンス解析エラー）`);
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
        type: char.type ?? "character",
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

  // Populate characters_present in chunks based on name matching
  const chapterChunks = await db.chunks.where("chapter_id").equals(chapter.id).sortBy("position");
  const appearing_entities: Entity[] = appearing_ids.map(id => {
    for (const [, e] of entityByKey) { if (e.id === id) return e; }
    return undefined;
  }).filter((e): e is Entity => e != null);
  // deduplicate
  const seenIds = new Set<string>();
  const unique_appearing = appearing_entities.filter(e => { if (seenIds.has(e.id)) return false; seenIds.add(e.id); return true; });
  await Promise.all(chapterChunks.map(chunk => {
    const present: string[] = [];
    for (const entity of unique_appearing) {
      const names = [entity.canonical_name, ...entity.aliases].filter(n => n.length >= 2);
      if (names.some(n => chunk.text.includes(n))) present.push(entity.id);
    }
    return present.length > 0 ? db.chunks.update(chunk.id, { characters_present: present }) : Promise.resolve();
  }));

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

  // Write structured events to db.events
  const eventIds: string[] = [];
  if (result.events && result.events.length > 0) {
    const allChunks = await db.chunks.where("chapter_id").equals(chapter.id).sortBy("position");

    for (const raw of result.events) {
      if (!raw.what) continue;

      // Find most relevant chunk for this event
      const queryTerms = [raw.what, ...(raw.who ?? [])].join(" ").toLowerCase().split(/\s+/).filter(t => t.length > 1);
      let bestChunk = allChunks[0];
      let bestScore = 0;
      for (const c of allChunks) {
        const score = queryTerms.filter(t => c.text.toLowerCase().includes(t)).length;
        if (score > bestScore) { bestScore = score; bestChunk = c; }
      }

      // Resolve participant entity IDs
      const participantIds: string[] = [];
      for (const name of raw.who ?? []) {
        const entity = entityByKey.get(name.toLowerCase());
        if (entity) participantIds.push(entity.id);
      }

      const eventWho: EventParticipant[] = participantIds.map(id => ({
        entity_id: id,
        role: "participant",
      }));

      const occurrence: EventOccurrence = {
        chapter_id: chapter.id,
        chapter_number: chapter.chapter_number,
        chunk_id: bestChunk?.id,
        note: raw.note ?? "",
      };

      // Check if an event with same `what` already exists for this work
      const existingEvents = await db.events
        .where("work_id").equals(chapter.work_id)
        .filter(e => e.what.toLowerCase() === raw.what.toLowerCase())
        .toArray();

      if (existingEvents.length > 0) {
        // Append occurrence to existing event (avoid dup for same chapter)
        const existing = existingEvents[0];
        const alreadyHasChapter = existing.occurrences.some(o => o.chapter_id === chapter.id);
        if (!alreadyHasChapter) {
          const updatedOccurrences = [...existing.occurrences, occurrence];
          await db.events.update(existing.id, { occurrences: updatedOccurrences });
        }
        eventIds.push(existing.id);
      } else {
        // Create new event
        const newEvent: Event = {
          id: crypto.randomUUID(),
          work_id: chapter.work_id,
          chapter_id: chapter.id,
          who: eventWho,
          what: raw.what,
          where: raw.where,
          when: raw.when,
          why: raw.why,
          how: raw.how,
          occurrences: [occurrence],
          first_chapter: chapter.chapter_number,
          consequences: raw.consequences ?? [],
          related_events: [],
          witnesses: [],
          unaware_characters: [],
          participants: participantIds,
          content_tags: [],
        };
        await db.events.add(newEvent);
        eventIds.push(newEvent.id);

        // Embed new event for RAG retrieval (best-effort)
        const eventEmbedder = await getEmbedder();
        if (eventEmbedder) {
          const eventText = [newEvent.what, newEvent.how, newEvent.why, newEvent.where]
            .filter(Boolean).join(" ");
          try {
            const [emb] = await eventEmbedder([eventText]);
            await db.events.update(newEvent.id, { embedding: emb });
          } catch {}
        }
      }
    }
  }

  // Update chapter with event IDs
  if (eventIds.length > 0) {
    await db.chapters.update(chapter.id, { event_ids: eventIds });
  }

  // Process entity state updates (location / item arcs)
  for (const update of result.entity_updates ?? []) {
    if (!update.name || !update.state_note) continue;
    const nameLower = update.name.toLowerCase();
    // Try exact match first, then substring fallback for partial names from LLM
    let entity = entityByKey.get(nameLower);
    if (!entity) {
      for (const [key, e] of entityByKey) {
        if ((e.type === "location" || e.type === "item" || e.type === "organization") &&
            (key.includes(nameLower) || nameLower.includes(key))) {
          entity = e;
          break;
        }
      }
    }
    if (!entity || (entity.type !== "location" && entity.type !== "item" && entity.type !== "organization")) continue;

    let ext: EntityExtended | undefined = await db.entities_extended.get(entity.id);
    if (!ext) {
      ext = { id: entity.id, work_id: chapter.work_id, state_snapshots: [] };
      await db.entities_extended.add(ext);
    }

    const existingIdx = ext.state_snapshots.findIndex(s => s.at_chapter === chapter.chapter_number);
    const snapshot: EntityStateSnapshot = {
      at_chapter: chapter.chapter_number,
      state_note: update.state_note,
      controller: update.controller,
      holder: update.holder,
      status: update.status,
    };

    const snapshots = [...ext.state_snapshots];
    if (existingIdx >= 0) snapshots[existingIdx] = snapshot;
    else snapshots.push(snapshot);

    await db.entities_extended.update(entity.id, { state_snapshots: snapshots });
  }

  // Step 2: Update character profiles for appearing characters (best-effort)
  onStatus?.("profile_update");
  await updateCharacterProfilesStep2(chapter, result, entityByKey, lang).catch(() => {});

  // Compute chunk embeddings (best-effort; silent skip if no embedding client)
  onStatus?.("embedding");
  await embedChapter(chapter.id).catch(() => {});

  onStatus?.("done");
}

/**
 * Resets analysis data for chapters >= from_chapter.
 * Used for re-parse: "from_chapter=1" clears everything; "from_chapter=N" clears from N onward.
 * Raw chapter text and chunks (text) are preserved; only derived/analysis data is removed.
 */
export async function clearWorkAnalysis(work_id: string, from_chapter = 1): Promise<void> {
  const chapters = await db.chapters
    .where("work_id").equals(work_id)
    .filter(c => c.chapter_number >= from_chapter)
    .toArray();
  const chapterIds = new Set(chapters.map(c => c.id));

  // Reset chapter analysis fields (keep full_text, title, chapter_number)
  await Promise.all(chapters.map(ch => db.chapters.update(ch.id, {
    summary_ultra: "", summary_short: "", summary_medium: "",
    appearing_characters: [], mentioned_items: [], key_events: [],
    event_ids: undefined, embedding_summary: undefined,
  })));

  // Delete entities whose first appearance is in the reset range
  const deleteEntities = await db.entities
    .where("work_id").equals(work_id)
    .filter(e => e.first_appearance != null && e.first_appearance >= from_chapter)
    .toArray();
  const deleteIds = deleteEntities.map(e => e.id);
  await db.entities.bulkDelete(deleteIds);
  await db.characters_extended.bulkDelete(deleteIds);
  await db.entities_extended.bulkDelete(deleteIds);

  // Trim state_snapshots on surviving entities
  const surviving = await db.entities.where("work_id").equals(work_id).toArray();
  await Promise.all(surviving.flatMap(entity => {
    const tasks: Promise<unknown>[] = [];
    tasks.push(
      db.characters_extended.get(entity.id).then(ext => {
        if (!ext) return;
        const trimmed = ext.state_snapshots.filter(s => s.at_chapter < from_chapter);
        if (trimmed.length !== ext.state_snapshots.length)
          return db.characters_extended.update(entity.id, { state_snapshots: trimmed });
      }),
      db.entities_extended.get(entity.id).then(ext => {
        if (!ext) return;
        const trimmed = ext.state_snapshots.filter(s => s.at_chapter < from_chapter);
        if (trimmed.length !== ext.state_snapshots.length)
          return db.entities_extended.update(entity.id, { state_snapshots: trimmed });
      }),
    );
    return tasks;
  }));

  // Delete events first appearing in reset range
  await db.events
    .where("work_id").equals(work_id)
    .filter(e => e.first_chapter >= from_chapter)
    .delete();

  // Trim occurrences from older events that reference reset chapters
  const olderEvents = await db.events.where("work_id").equals(work_id).toArray();
  await Promise.all(olderEvents.map(event => {
    const trimmed = event.occurrences.filter(o => !chapterIds.has(o.chapter_id));
    if (trimmed.length !== event.occurrences.length)
      return db.events.update(event.id, { occurrences: trimmed });
  }));

  // Reset chunk derived data (keep text)
  const allChunkIds = (await Promise.all(
    [...chapterIds].map(cid => db.chunks.where("chapter_id").equals(cid).toArray())
  )).flat();
  await Promise.all(allChunkIds.map(c => db.chunks.update(c.id, {
    characters_present: [], events: [], items: [], embedding: undefined,
  })));
}

export async function embedChapter(chapter_id: string): Promise<void> {
  const embedder = await getEmbedder();
  if (!embedder) return;

  const chunks = await db.chunks.where("chapter_id").equals(chapter_id).sortBy("position");
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
    return !ext || !ext.persona || !ext.speech_style;
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

    // Fetch dialogue-heavy chunks for this character (up to 5)
    const chunkTexts: string[] = [];
    for (const ch of appearingChapters.slice(0, 5)) {
      const chunks = await db.chunks.where("chapter_id").equals(ch.id)
        .filter(c => c.characters_present.includes(entity.id))
        .limit(2)
        .toArray();
      // Fallback: keyword matching if no direct match
      if (chunks.length === 0) {
        const allChunks = await db.chunks.where("chapter_id").equals(ch.id).toArray();
        const keyword = entity.canonical_name.slice(0, 4).toLowerCase();
        const matched = allChunks.filter(c => c.text.toLowerCase().includes(keyword)).slice(0, 2);
        for (const c of matched) chunkTexts.push(c.text.slice(0, 300));
      } else {
        for (const c of chunks) chunkTexts.push(c.text.slice(0, 300));
      }
      if (chunkTexts.length >= 5) break;
    }
    const chunkContext = chunkTexts.join("\n\n---\n\n");

    const prompt = isChinese
      ? `請根據以下資料，為小說角色「${entity.canonical_name}」生成角色扮演用JSON數據。

【角色基本資訊】
說明：${entity.description || "（無）"}

【出場章節概要】
${chapterContext || "（無）"}

【相關文本摘錄】
${chunkContext || "（無）"}

請只返回以下JSON格式（不要說明）:
{
  "persona": "400～500字的角色扮演設定。①個性與行動模式 ②價值觀與信念 ③過去經歷與現狀 ④與讀者的互動方式",
  "speech_style": "50～100字描述說話特徵。語調、語尾、口頭禪、情感表達模式",
  "voice_samples": ["直接引用的臺詞（脫離前後文也能理解的）", "另一句臺詞例", "第三句臺詞例"]
}`
      : `以下の情報をもとに「${entity.canonical_name}」のロールプレイ用データをJSONで生成してください。

【キャラクター基本情報】
説明: ${entity.description || "（なし）"}

【登場章の概要】
${chapterContext || "（なし）"}

【関連テキスト抜粋】
${chunkContext || "（なし）"}

以下のJSON形式のみで返答（説明不要）:
{
  "persona": "400〜500文字でキャラクターのロールプレイ設定を記述。①性格と行動パターン ②価値観と信念 ③過去の経緯と現在の状況 ④読者への態度と接し方 を含めること",
  "speech_style": "50〜100文字で話し方の特徴を記述。口調・語尾・言葉の癖・感情表現のパターンを具体的に",
  "voice_samples": ["実際のセリフをそのまま引用（文脈抜きで意味が通るもの）", "別のセリフ例", "3つ目のセリフ例"]
}`;

    try {
      const raw = await client.complete([{ role: "user", content: prompt }]);
      let result: { persona?: string; speech_style?: string; voice_samples?: string[] } = {};
      try {
        result = extractJson(raw) as typeof result;
      } catch {
        // Fallback: treat raw as plain persona text
        result = { persona: raw.trim() };
      }

      const ext = extMap.get(entity.id);
      const updates: Partial<CharacterExtended> = {};
      if (result.persona) updates.persona = result.persona;
      if (result.speech_style) updates.speech_style = result.speech_style;
      if (result.voice_samples && result.voice_samples.length > 0) {
        updates.voice_samples = result.voice_samples.map(line => ({ context: "", line }));
      }

      if (ext) {
        await db.characters_extended.update(entity.id, updates);
        Object.assign(ext, updates);
      } else {
        const newExt: CharacterExtended = {
          id: entity.id, work_id,
          persona: updates.persona ?? "", speech_style: updates.speech_style,
          voice_samples: updates.voice_samples ?? [],
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

export async function enrichEvents(
  work_id: string,
  onProgress?: (done: number, total: number, current: string) => void,
  onError?: (msg: string) => void,
): Promise<number> {
  const clientResult = await LlmClient.forRole("sub_agent");
  const client = clientResult ?? await LlmClient.forRole("main");
  const [allEvents, allChapters] = await Promise.all([
    db.events.where("work_id").equals(work_id).filter(e => !e.is_enriched).toArray(),
    db.chapters.where("work_id").equals(work_id).sortBy("chapter_number"),
  ]);
  if (!client || allEvents.length === 0) return 0;
  void allChapters; // available for future use

  const work = await db.works.get(work_id);
  const lang = work?.language ?? "ja";
  const isChinese = lang === "zh-tw" || lang === "zh-cn" || lang === "zh";
  const isEn = lang === "en";

  // Step 1: Group events by similarity using LLM
  const eventList = allEvents.map((e, i) => `${i}: [第${e.first_chapter}章] ${e.what}`).join("\n");

  const groupingPrompt = isChinese
    ? `以下是從小說各章節提取的事件清單。\n` +
      `請將同一或連續的事件（例如：同一事件的發生・進展・結末）分組。\n\n` +
      `${eventList}\n\n` +
      `只返回JSON:\n` +
      `{ "groups": [[0,3,7], [1,5], [2], [4,6]] }\n` +
      `每組為同一事件的索引列表。單獨事件也必須包含在列表中。`
    : isEn
      ? `The following is a list of events extracted from each chapter of a novel.\n` +
        `Group together events that are the same or consecutive (e.g., the onset, development, and resolution of the same incident).\n\n` +
        `${eventList}\n\n` +
        `Return JSON only:\n` +
        `{ "groups": [[0,3,7], [1,5], [2], [4,6]] }\n` +
        `Each group is a list of indices for the same event. Single events must also be included in a list.`
      : `以下は小説の各章から抽出されたイベント一覧です。\n` +
        `同一または連続する出来事（例：同じ事件の発生・進展・結末）をグループ化してください。\n\n` +
        `${eventList}\n\n` +
        `JSONのみ返答:\n` +
        `{ "groups": [[0,3,7], [1,5], [2], [4,6]] }\n` +
        `各グループは同一イベントのインデックスリスト。単独イベントも必ずリストに含めること。`;

  let groups: number[][] = allEvents.map((_, i) => [i]); // default: each event is its own group
  try {
    const raw = await client.complete([{ role: "user", content: groupingPrompt }]);
    const parsed = extractJson(raw) as { groups?: number[][] };
    if (parsed.groups && Array.isArray(parsed.groups)) {
      groups = parsed.groups.filter(g => Array.isArray(g) && g.length > 0);
    }
  } catch {}

  // Step 2: For each group, merge events and enrich with LLM
  let enriched = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupEvents = group.map(i => allEvents[i]).filter(Boolean);
    if (groupEvents.length === 0) continue;

    const primary = groupEvents[0];
    onProgress?.(gi, groups.length, primary.what);

    if (groupEvents.length === 1 && primary.occurrences.length === 1) {
      // Single occurrence — just enrich the 5W1H
      const enrichPrompt = isChinese
        ? `請補充以下事件資訊。\n` +
          `事件名稱: ${primary.what}\n` +
          `發生章節: 第${primary.first_chapter}章\n` +
          `描述: ${primary.occurrences[0].note}\n\n` +
          `只返回JSON:\n` +
          `{ "where": "地點", "when": "時間帶・時機", "why": "原因・動機", "how": "手段・經過", "consequences": ["結果1", "結果2"] }`
        : isEn
          ? `Please fill in the missing information for the following event.\n` +
            `Event: ${primary.what}\n` +
            `Chapter: ${primary.first_chapter}\n` +
            `Description: ${primary.occurrences[0].note}\n\n` +
            `Return JSON only:\n` +
            `{ "where": "location", "when": "time/timing", "why": "cause/motivation", "how": "means/circumstances", "consequences": ["result1", "result2"] }`
          : `以下のイベント情報を補完してください。\n` +
            `イベント名: ${primary.what}\n` +
            `発生章: 第${primary.first_chapter}章\n` +
            `記述: ${primary.occurrences[0].note}\n\n` +
            `JSONのみ返答:\n` +
            `{ "where": "場所", "when": "時間帯・タイミング", "why": "原因・動機", "how": "手段・経緯", "consequences": ["結果1", "結果2"] }`;
      try {
        const raw = await client.complete([{ role: "user", content: enrichPrompt }]);
        const enriched5W1H = extractJson(raw) as Partial<Event>;
        await db.events.update(primary.id, {
          ...enriched5W1H,
          is_enriched: true,
        });
        enriched++;
      } catch (e) {
        onError?.(String(e));
        await db.events.update(primary.id, { is_enriched: true });
      }
      continue;
    }

    // Multiple events in group — merge occurrences and enrich
    const mergedOccurrences: EventOccurrence[] = [];
    const seenChapters = new Set<string>();
    const allParticipants = new Set<string>();

    for (const ev of groupEvents) {
      for (const occ of ev.occurrences) {
        if (!seenChapters.has(occ.chapter_id)) {
          seenChapters.add(occ.chapter_id);
          mergedOccurrences.push(occ);
        }
      }
      for (const p of ev.participants) allParticipants.add(p);
    }
    mergedOccurrences.sort((a, b) => a.chapter_number - b.chapter_number);

    const occNotes = mergedOccurrences.map(o => `第${o.chapter_number}章: ${o.note}`).join("\n");
    const mergePrompt = isChinese
      ? `以下是同一事件跨多章的記錄。請整合並完成5W1H。\n\n` +
        `${occNotes}\n\n` +
        `只返回JSON:\n` +
        `{ "what": "整合後的事件名稱（50字以內）", "where": "地點", "when": "期間・時機", ` +
        `"why": "原因・動機", "how": "手段・經過", "consequences": ["結果1", "結果2"] }`
      : isEn
        ? `The following are records of the same event spanning multiple chapters. Integrate them and complete the 5W1H.\n\n` +
          `${occNotes}\n\n` +
          `Return JSON only:\n` +
          `{ "what": "integrated event name (under 50 words)", "where": "location", "when": "period/timing", ` +
          `"why": "cause/motivation", "how": "means/circumstances", "consequences": ["result1", "result2"] }`
        : `以下は同一イベントの複数章にわたる記録です。統合して5W1Hを完成させてください。\n\n` +
          `${occNotes}\n\n` +
          `JSONのみ返答:\n` +
          `{ "what": "統合した事件名（50文字以内）", "where": "場所", "when": "期間・タイミング", ` +
          `"why": "原因・動機", "how": "手段・経緯", "consequences": ["結果1", "結果2"] }`;

    try {
      const raw = await client.complete([{ role: "user", content: mergePrompt }]);
      const merged = extractJson(raw) as Partial<Event>;

      // Update primary event with merged data
      await db.events.update(primary.id, {
        ...merged,
        occurrences: mergedOccurrences,
        participants: [...allParticipants],
        is_enriched: true,
      });

      // Delete secondary events in this group
      const secondaryIds = groupEvents.slice(1).map(e => e.id);
      await db.events.bulkDelete(secondaryIds);

      // Update chapter event_ids to replace secondary IDs with primary
      for (const ev of groupEvents.slice(1)) {
        for (const occ of ev.occurrences) {
          const ch = await db.chapters.get(occ.chapter_id);
          if (ch?.event_ids) {
            const newIds = ch.event_ids.map(id => secondaryIds.includes(id) ? primary.id : id);
            const deduped = [...new Set(newIds)];
            await db.chapters.update(occ.chapter_id, { event_ids: deduped });
          }
        }
      }
      enriched++;
    } catch (e) {
      onError?.(String(e));
    }
  }

  return enriched;
}

export async function reanalyzeWork(
  work_id: string,
  onProgress?: BatchProgressFn,
  onError?: (msg: string) => void,
  onBlockProgress?: (block: number, total: number) => void,
): Promise<void> {
  // Reset generated fields on non-author-provided profiles to avoid stale-language contamination
  await db.characters_extended
    .where("work_id").equals(work_id)
    .filter(ext => !ext.author_provided)
    .modify({ persona: "", speech_style: undefined, voice_samples: [], state_snapshots: [] });

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

export interface KakuyomuIngestOptions {
  work_title: string;
  work_author: string;
  work_url: string;
  tab_id: number;
  episodes: Array<{ episode_id: string; title: string; order: number }>;
  language: Language;
  onStatus?: (msg: string) => void;
  onProgress?: (done: number, total: number) => void;
  onError?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function ingestKakuyomuWork(opts: KakuyomuIngestOptions): Promise<Work | null> {
  const work = await getOrCreateWork({
    title: opts.work_title,
    author: opts.work_author,
    language: opts.language,
    source_type: "authorized",
    platform: "kakuyomu",
    platform_url: opts.work_url,
  });

  const existingChapters = await listChapters(work.id);
  const nextChapterNum = existingChapters.length > 0
    ? Math.max(...existingChapters.map(c => c.chapter_number)) + 1
    : 1;

  const workId = new URL(opts.work_url).pathname.split("/")[2];

  for (let i = 0; i < opts.episodes.length; i++) {
    if (opts.signal?.aborted) break;
    const ep = opts.episodes[i];
    opts.onStatus?.(`「${ep.title}」を読み込み中...`);

    let text: string | null = null;
    try {
      text = await chrome.tabs.sendMessage(opts.tab_id, {
        type: "KK_FETCH_EPISODE",
        episode_id: ep.episode_id,
        work_id: workId,
      }) as string | null;
    } catch {
      opts.onError?.(`「${ep.title}」の取得に失敗しました`);
      opts.onProgress?.(i + 1, opts.episodes.length);
      continue;
    }

    if (!text) {
      opts.onError?.(`「${ep.title}」のコンテンツが取得できませんでした`);
      opts.onProgress?.(i + 1, opts.episodes.length);
      continue;
    }

    await ingestPastedText(work.id, nextChapterNum + i, ep.title, text, opts.onStatus, opts.onError);
    opts.onProgress?.(i + 1, opts.episodes.length);
  }

  return work;
}

export interface SyosetsuIngestOptions {
  work_title: string;
  work_author: string;
  work_url: string;
  ncode: string;
  tab_id: number;
  chapters: Array<{ chapter_num: number; title: string; order: number }>;
  language: Language;
  onStatus?: (msg: string) => void;
  onProgress?: (done: number, total: number) => void;
  onError?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function ingestSyosetsuWork(opts: SyosetsuIngestOptions): Promise<Work | null> {
  const work = await getOrCreateWork({
    title: opts.work_title,
    author: opts.work_author,
    language: opts.language,
    source_type: "authorized",
    platform: "syosetu",
    platform_url: opts.work_url,
  });

  const existingChapters = await listChapters(work.id);
  const nextChapterNum = existingChapters.length > 0
    ? Math.max(...existingChapters.map(c => c.chapter_number)) + 1
    : 1;

  for (let i = 0; i < opts.chapters.length; i++) {
    if (opts.signal?.aborted) break;
    const ch = opts.chapters[i];
    opts.onStatus?.(`「${ch.title}」を読み込み中...`);

    let text: string | null = null;
    try {
      text = await chrome.tabs.sendMessage(opts.tab_id, {
        type: "SS_FETCH_CHAPTER",
        ncode: opts.ncode,
        chapter_num: ch.chapter_num,
      }) as string | null;
    } catch {
      opts.onError?.(`「${ch.title}」の取得に失敗しました`);
      opts.onProgress?.(i + 1, opts.chapters.length);
      continue;
    }

    if (!text) {
      opts.onError?.(`「${ch.title}」のコンテンツが取得できませんでした`);
      opts.onProgress?.(i + 1, opts.chapters.length);
      continue;
    }

    await ingestPastedText(work.id, nextChapterNum + i, ch.title, text, opts.onStatus, opts.onError);
    opts.onProgress?.(i + 1, opts.chapters.length);
  }

  return work;
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

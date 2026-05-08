import { db } from "@/lib/storage";
import type { Chunk, Entity, Chapter } from "@/lib/storage";
import { getEmbedder } from "@/lib/embedding";

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function toFloat32Array(v: unknown): Float32Array | undefined {
  if (!v) return undefined;
  if (v instanceof Float32Array) return v;
  if (v instanceof ArrayBuffer) return new Float32Array(v);
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") {
    return new Float32Array(v);
  }
  return undefined;
}

// CJK-aware tokenizer: bigrams for CJK, words for Latin/other
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const s = text.toLowerCase();
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const char = String.fromCodePoint(cp);
    const charLen = char.length;

    const isCJK = (cp >= 0x4e00 && cp <= 0x9fff)   // CJK Unified
               || (cp >= 0x3040 && cp <= 0x30ff)    // Hiragana/Katakana
               || (cp >= 0x3400 && cp <= 0x4dbf)    // CJK Extension A
               || (cp >= 0xf900 && cp <= 0xfaff)    // CJK Compatibility
               || (cp >= 0xac00 && cp <= 0xd7af);   // Hangul

    if (isCJK) {
      // Unigram
      tokens.push(char);
      // Bigram with next char
      const next = s.slice(i + charLen, i + charLen + 2);
      if (next.length > 0) tokens.push(char + next[0]);
      i += charLen;
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      let word = char;
      i += charLen;
      while (i < s.length) {
        const nc = s.codePointAt(i)!;
        const nchar = String.fromCodePoint(nc);
        if (!/[\p{L}\p{N}]/u.test(nchar)) break;
        word += nchar;
        i += nchar.length;
      }
      if (word.length > 1) tokens.push(word);
    } else {
      i += charLen;
    }
  }
  return tokens;
}

function keywordScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0;
  const docTokens = new Set(tokenize(text));
  return queryTokens.filter(t => docTokens.has(t)).length / queryTokens.length;
}

export interface RetrievalResult {
  chunk: Chunk;
  score: number;
}

export async function retrieveChunks(
  work_id: string,
  query: string,
  cutoff_chapter: number,
  top_k = 5,
  character_id?: string,
): Promise<RetrievalResult[]> {
  const chapters = await db.chapters
    .where("work_id").equals(work_id)
    .filter(c => c.chapter_number <= cutoff_chapter)
    .toArray();

  // Prioritize chapters where the character appears; limit search space
  const charChapters = character_id
    ? chapters.filter(c => c.appearing_characters.includes(character_id))
    : chapters;
  const recent = chapters.slice(-10);
  const searchSet = new Map([...charChapters, ...recent].map(c => [c.id, c]));
  const searchChapterIds = [...searchSet.keys()];

  const chunks = searchChapterIds.length > 0
    ? await db.chunks.where("chapter_id").anyOf(searchChapterIds).toArray()
    : [];

  const queryTokens = tokenize(query);
  return chunks
    .map(chunk => ({ chunk, score: keywordScore(queryTokens, chunk.text) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);
}

export async function retrieveEntities(
  work_id: string,
  query: string,
  top_k = 5,
): Promise<Entity[]> {
  const entities = await db.entities.where("work_id").equals(work_id).toArray();
  const queryTokens = tokenize(query);
  return entities
    .map(e => ({
      entity: e,
      s: keywordScore(queryTokens, [e.canonical_name, ...e.aliases, e.description].join(" ")),
    }))
    .filter(r => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, top_k)
    .map(r => r.entity);
}

async function retrieveChunksHybrid(
  work_id: string,
  query: string,
  queryEmbedding: Float32Array | null,
  cutoff_chapter: number,
  top_k = 5,
  character_id?: string,
): Promise<RetrievalResult[]> {
  const chapters = await db.chapters
    .where("work_id").equals(work_id)
    .filter(c => c.chapter_number <= cutoff_chapter)
    .toArray();

  // Pre-filter chapters using chapter-level embeddings if available
  let relevantChapterIds: Set<string>;

  if (queryEmbedding && chapters.some(c => c.embedding_summary)) {
    // Score chapters by embedding similarity
    const chapterScores = chapters.map(c => {
      const emb = toFloat32Array(c.embedding_summary);
      return { c, embScore: emb ? cosineSimilarity(queryEmbedding, emb) : 0 };
    });

    // Character chapters + top embedding chapters + recent chapters
    const charChapters = character_id
      ? chapters.filter(c => c.appearing_characters.includes(character_id))
      : [];
    const topByEmbedding = chapterScores
      .sort((a, b) => b.embScore - a.embScore)
      .slice(0, 15)
      .map(x => x.c);
    const recent = chapters.slice(-5);

    const combined = new Map([...charChapters, ...topByEmbedding, ...recent].map(c => [c.id, c]));
    relevantChapterIds = new Set(combined.keys());
  } else {
    // Fallback: character chapters + recent
    const charChapters = character_id
      ? chapters.filter(c => c.appearing_characters.includes(character_id))
      : chapters;
    const recent = chapters.slice(-10);
    const combined = new Map([...charChapters, ...recent].map(c => [c.id, c]));
    relevantChapterIds = new Set(combined.keys());
  }

  const chunks = relevantChapterIds.size > 0
    ? await db.chunks.where("chapter_id").anyOf([...relevantChapterIds]).toArray()
    : [];

  const queryTokens = tokenize(query);
  const KEYWORD_WEIGHT = 0.35;
  const EMBEDDING_WEIGHT = 0.65;

  const results: RetrievalResult[] = chunks.map(chunk => {
    const kwScore = keywordScore(queryTokens, chunk.text);

    let embScore = 0;
    if (queryEmbedding) {
      const emb = toFloat32Array(chunk.embedding);
      if (emb) embScore = Math.max(0, cosineSimilarity(queryEmbedding, emb));
    }

    // If no embeddings at all, use keyword only
    const hasAnyEmbedding = queryEmbedding !== null;
    const score = hasAnyEmbedding
      ? EMBEDDING_WEIGHT * embScore + KEYWORD_WEIGHT * kwScore
      : kwScore;

    return { chunk, score };
  });

  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top_k);
}

export async function buildContext(
  work_id: string,
  character_id: string,
  query: string,
  cutoff_chapter: number,
  character_version_id?: string,
): Promise<string> {
  const embedder = await getEmbedder();
  let queryEmbedding: Float32Array | null = null;
  if (embedder) {
    try { [queryEmbedding] = await embedder([query]); } catch {}
  }

  const [chunks, relatedEntities, character, characterExt, allChapters] = await Promise.all([
    retrieveChunksHybrid(work_id, query, queryEmbedding, cutoff_chapter, 5, character_id),
    retrieveEntities(work_id, query, 5),
    db.entities.get(character_id),
    db.characters_extended.get(character_id),
    db.chapters
      .where("work_id").equals(work_id)
      .filter(c => c.chapter_number <= cutoff_chapter)
      .sortBy("chapter_number"),
  ]);

  const parts: string[] = [];

  // Character info
  const snapshot = character_version_id && character_version_id !== "base" && characterExt
    ? characterExt.state_snapshots.find(s => s.id === character_version_id)
    : undefined;
  const effectivePersona = snapshot?.persona_override ?? characterExt?.persona ?? "";
  const effectiveSpeechStyle = snapshot?.speech_style_override ?? characterExt?.speech_style;

  if (character) parts.push(`## キャラクター: ${character.canonical_name}\n${character.description}`);
  if (effectivePersona) parts.push(`## キャラクター設定\n${effectivePersona}`);
  if (effectiveSpeechStyle) parts.push(`話し方: ${effectiveSpeechStyle}`);

  // Story context — tiered: recent 3 get full detail, top-3 relevant get ultra summary
  const charChapters = allChapters.filter(c => c.appearing_characters.includes(character_id));
  const chapPool = charChapters.length > 0 ? charChapters : allChapters;

  const recentThree = chapPool.slice(-3);
  const queryTokens = tokenize(query);
  const topRelevant = chapPool
    .filter(c => !recentThree.includes(c))
    .map(c => ({
      c,
      s: keywordScore(queryTokens, [c.summary_short, c.summary_ultra, c.key_events.join(" ")].join(" ")),
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .filter(x => x.s > 0)
    .map(x => x.c);

  const chaptersToShow = [...topRelevant, ...recentThree]
    .sort((a, b) => a.chapter_number - b.chapter_number);

  if (chaptersToShow.length > 0) {
    const storyLines = chaptersToShow.map(c => {
      const isRecent = recentThree.includes(c);
      const lines = [`第${c.chapter_number}章「${c.title}」`];
      if (isRecent) {
        if (c.summary_short) lines.push(c.summary_short);
        if (c.key_events.length > 0)
          lines.push(c.key_events.slice(0, 5).map(e => `・${e}`).join("\n"));
      } else {
        if (c.summary_ultra) lines.push(c.summary_ultra);
      }
      return lines.join("\n");
    });
    parts.push(`## 関連する出来事\n${storyLines.join("\n\n")}`);
  }

  // Related entities (exclude the character itself)
  const filteredEntities = relatedEntities.filter(e => e.id !== character_id);
  if (filteredEntities.length > 0) {
    parts.push("## 関連人物・概念\n" + filteredEntities.map(e =>
      `- ${e.canonical_name}: ${e.description}`
    ).join("\n"));
  }

  // Text chunks (most valuable — keep all top_k)
  if (chunks.length > 0) {
    parts.push("## 関連本文\n" + chunks.map(r => r.chunk.text).join("\n\n---\n\n"));
  }

  return parts.join("\n\n");
}

export async function getChaptersUpTo(work_id: string, cutoff: number): Promise<Chapter[]> {
  return db.chapters
    .where("work_id").equals(work_id)
    .filter(c => c.chapter_number <= cutoff)
    .sortBy("chapter_number");
}

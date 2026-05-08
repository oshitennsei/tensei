import { db } from "./db";
import { getModelForRole } from "@/lib/llm";
import type { Work, Chapter, Chunk, Entity, CharacterExtended } from "./types";

export const EXPORT_VERSION = "1.0";
export const EXPORT_APP = "tensei";

export interface ExportOptions {
  include_text: boolean;
  include_embeddings: boolean;
  creator?: string;
  label?: string;
}

export type SerializedChapter = Omit<Chapter, "full_text" | "embedding_summary"> & {
  full_text?: string;
  embedding_summary?: number[];
};

export type SerializedChunk = {
  id: string;
  chapter_id: string;
  position: number;
  text?: string;
  embedding?: number[];
  characters_present: string[];
  events: string[];
  items: string[];
  content_tags: string[];
};

export type SerializedEntity = Omit<Entity, "embedding"> & { embedding?: number[] };

export interface WorkExportManifest {
  version: typeof EXPORT_VERSION;
  exported_at: number;
  app: typeof EXPORT_APP;
  creator?: string;
  label?: string;
  embedding_model: string | null;
  embedding_dim: number | null;
  includes_text: boolean;
  work: Work;
  chapters: SerializedChapter[];
  chunks: SerializedChunk[];
  entities: SerializedEntity[];
  characters_extended: CharacterExtended[];
}

// Float32Array from Dexie may come back as ArrayBuffer in some environments
function toNumberArray(v: unknown): number[] | null {
  if (!v) return null;
  if (v instanceof Float32Array) return Array.from(v);
  if (v instanceof ArrayBuffer) return Array.from(new Float32Array(v));
  if (Array.isArray(v)) return v as number[];
  return null;
}

async function getEmbeddingMeta(work_id: string): Promise<{ model: string | null; dim: number | null }> {
  const model = await getModelForRole("embedding");
  if (!model) return { model: null, dim: null };
  const chapter = await db.chapters.where("work_id").equals(work_id).first();
  if (!chapter) return { model: model.model_name, dim: null };
  const chunk = await db.chunks.where("chapter_id").equals(chapter.id).first();
  return { model: model.model_name, dim: chunk?.embedding?.length ?? null };
}

export interface EmbeddingStats {
  model: string | null;
  total_chunks: number;
  embedded_chunks: number;
}

export async function getEmbeddingStats(work_id: string): Promise<EmbeddingStats> {
  const model = await getModelForRole("embedding");
  const chapters = await db.chapters.where("work_id").equals(work_id).toArray();
  const chapterIds = chapters.map(c => c.id);
  const chunks = chapterIds.length > 0
    ? await db.chunks.where("chapter_id").anyOf(chapterIds).toArray()
    : [];
  const embedded = chunks.filter(c => {
    if (c.embedding == null) return false;
    if (c.embedding instanceof Float32Array) return c.embedding.length > 0;
    if (c.embedding instanceof ArrayBuffer) return c.embedding.byteLength > 0;
    if (Array.isArray(c.embedding)) return (c.embedding as number[]).length > 0;
    return false;
  }).length;
  return { model: model?.model_name ?? null, total_chunks: chunks.length, embedded_chunks: embedded };
}

export async function exportWork(work_id: string, options: ExportOptions): Promise<WorkExportManifest> {
  const [work, chapters, entities, characters_extended] = await Promise.all([
    db.works.get(work_id),
    db.chapters.where("work_id").equals(work_id).sortBy("chapter_number"),
    db.entities.where("work_id").equals(work_id).toArray(),
    db.characters_extended.where("work_id").equals(work_id).toArray(),
  ]);
  if (!work) throw new Error("Work not found");

  const { model: embedding_model, dim: embedding_dim } = options.include_embeddings
    ? await getEmbeddingMeta(work_id)
    : { model: null, dim: null };

  const chapterIds = chapters.map(c => c.id);
  const allChunks = chapterIds.length > 0
    ? await db.chunks.where("chapter_id").anyOf(chapterIds).toArray()
    : [];

  const serializedChapters: SerializedChapter[] = chapters.map(
    ({ full_text, embedding_summary, ...rest }) => {
      const embArr = options.include_embeddings ? toNumberArray(embedding_summary) : null;
      return {
        ...rest,
        ...(options.include_text ? { full_text } : {}),
        ...(embArr ? { embedding_summary: embArr } : {}),
      };
    }
  );

  const serializedChunks: SerializedChunk[] = allChunks.map(
    ({ text, embedding, scene_id: _s, mood: _m, ...rest }) => {
      const embArr = options.include_embeddings ? toNumberArray(embedding) : null;
      return {
        ...rest,
        ...(options.include_text ? { text } : {}),
        ...(embArr ? { embedding: embArr } : {}),
      };
    }
  );

  const serializedEntities: SerializedEntity[] = entities.map(
    ({ embedding, ...rest }) => {
      const embArr = options.include_embeddings ? toNumberArray(embedding) : null;
      return { ...rest, ...(embArr ? { embedding: embArr } : {}) };
    }
  );

  return {
    version: EXPORT_VERSION,
    exported_at: Date.now(),
    app: EXPORT_APP,
    ...(options.creator?.trim() ? { creator: options.creator.trim() } : {}),
    ...(options.label?.trim() ? { label: options.label.trim() } : {}),
    embedding_model: options.include_embeddings ? embedding_model : null,
    embedding_dim: options.include_embeddings ? embedding_dim : null,
    includes_text: options.include_text,
    work,
    chapters: serializedChapters,
    chunks: serializedChunks,
    entities: serializedEntities,
    characters_extended,
  };
}

export function downloadManifest(manifest: WorkExportManifest): void {
  const json = JSON.stringify(manifest);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date(manifest.exported_at).toISOString().slice(0, 10);
  a.download = `tensei-${manifest.work.title.slice(0, 20)}-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

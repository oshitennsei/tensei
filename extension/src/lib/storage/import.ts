import { db } from "./db";
import { getModelForRole } from "@/lib/llm";
import type { Work, Chapter, Chunk, Entity } from "./types";
import type { WorkExportManifest } from "./export";
import { EXPORT_VERSION, EXPORT_APP } from "./export";

export type ConflictAction = "overwrite" | "create_new";

export interface ImportOptions {
  conflict_action: ConflictAction;
}

export interface ImportResult {
  work_id: string;
  chapters_imported: number;
  entities_imported: number;
  embeddings_dropped: boolean;
}

export interface ParsedImport {
  manifest: WorkExportManifest;
  embedding_compatible: boolean;
  embedding_mismatch_reason?: string;
  existing_work: Work | null;
}

export function parseExportFile(json: string): WorkExportManifest {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error("JSONの解析に失敗しました。"); }
  const m = data as Record<string, unknown>;
  if (m.app !== EXPORT_APP) throw new Error("Tenseiのエクスポートファイルではありません。");
  if (m.version !== EXPORT_VERSION) throw new Error(`バージョン不一致 (${m.version})。`);
  return data as WorkExportManifest;
}

export async function analyzeImport(manifest: WorkExportManifest): Promise<ParsedImport> {
  let embedding_compatible = true;
  let embedding_mismatch_reason: string | undefined;

  if (manifest.embedding_model) {
    const model = await getModelForRole("embedding");
    if (!model) {
      embedding_compatible = false;
      embedding_mismatch_reason = `Embedding設定なし（必要: ${manifest.embedding_model}）`;
    } else if (model.model_name !== manifest.embedding_model) {
      embedding_compatible = false;
      embedding_mismatch_reason = `モデル不一致: 現在「${model.model_name}」← エクスポート「${manifest.embedding_model}」`;
    }
  }

  const existing_work = await db.works
    .where("title").equals(manifest.work.title)
    .filter(w => w.author === manifest.work.author)
    .first() ?? null;

  return { manifest, embedding_compatible, embedding_mismatch_reason, existing_work };
}

export async function importWork(parsed: ParsedImport, options: ImportOptions): Promise<ImportResult> {
  const { manifest } = parsed;
  const dropEmbeddings = !parsed.embedding_compatible;

  let work_id = manifest.work.id;

  if (options.conflict_action === "overwrite" && parsed.existing_work) {
    await deleteWorkData(parsed.existing_work.id);
    work_id = parsed.existing_work.id;
  } else if (options.conflict_action === "create_new") {
    work_id = crypto.randomUUID();
  }

  await db.transaction("rw", [
    db.works, db.chapters, db.chunks, db.entities, db.characters_extended,
  ], async () => {
    await db.works.put({ ...manifest.work, id: work_id });

    for (const ch of manifest.chapters) {
      const chapter: Chapter = {
        id: ch.id,
        work_id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        full_text: ch.full_text ?? "",
        summary_ultra: ch.summary_ultra,
        summary_short: ch.summary_short,
        summary_medium: ch.summary_medium,
        appearing_characters: ch.appearing_characters,
        mentioned_characters: ch.mentioned_characters,
        mentioned_items: ch.mentioned_items,
        key_events: ch.key_events,
        chunk_ids: ch.chunk_ids,
        ...(!dropEmbeddings && ch.embedding_summary
          ? { embedding_summary: new Float32Array(ch.embedding_summary) }
          : {}),
      };
      await db.chapters.put(chapter);
    }

    for (const ck of manifest.chunks) {
      const chunk: Chunk = {
        id: ck.id,
        chapter_id: ck.chapter_id,
        position: ck.position,
        text: ck.text ?? "",
        characters_present: ck.characters_present,
        events: ck.events,
        items: ck.items,
        content_tags: ck.content_tags,
        ...(!dropEmbeddings && ck.embedding
          ? { embedding: new Float32Array(ck.embedding) }
          : {}),
      };
      await db.chunks.put(chunk);
    }

    for (const e of manifest.entities) {
      const entity: Entity = {
        ...e,
        work_id,
        embedding: !dropEmbeddings && e.embedding
          ? new Float32Array(e.embedding as number[])
          : undefined,
      };
      await db.entities.put(entity);
    }

    for (const ce of manifest.characters_extended) {
      await db.characters_extended.put({ ...ce, work_id });
    }
  });

  return {
    work_id,
    chapters_imported: manifest.chapters.length,
    entities_imported: manifest.entities.length,
    embeddings_dropped: dropEmbeddings,
  };
}

async function deleteWorkData(work_id: string): Promise<void> {
  const chapters = await db.chapters.where("work_id").equals(work_id).toArray();
  await db.transaction("rw", [
    db.works, db.chapters, db.chunks, db.entities, db.characters_extended,
  ], async () => {
    for (const ch of chapters) {
      await db.chunks.where("chapter_id").equals(ch.id).delete();
    }
    await db.chapters.where("work_id").equals(work_id).delete();
    await db.entities.where("work_id").equals(work_id).delete();
    await db.characters_extended.where("work_id").equals(work_id).delete();
    await db.works.delete(work_id);
  });
}

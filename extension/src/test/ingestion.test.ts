import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/storage";
import {
  getOrCreateWork,
  ingestChapter,
  listWorks,
  listChapters,
  deleteWork,
} from "@/lib/ingestion";
import type { IngestWorkInput } from "@/lib/ingestion";

async function clearDb() {
  await db.works.clear();
  await db.chapters.clear();
  await db.chunks.clear();
  await db.entities.clear();
  await db.sessions.clear();
}

function makeWorkInput(overrides: Partial<IngestWorkInput> = {}): IngestWorkInput {
  return {
    title: "彼界の星",
    author: "テスト著者",
    language: "ja",
    platform: "kakuyomu",
    source_type: "authorized",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("getOrCreateWork", () => {
  beforeEach(clearDb);

  it("creates a new work and stores it in the database", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    expect(work.id).toBeTruthy();
    expect(work.title).toBe("彼界の星");
    expect(work.author).toBe("テスト著者");
    const stored = await db.works.get(work.id);
    expect(stored).toBeDefined();
  });

  it("returns the existing work instead of creating a duplicate (by title+author)", async () => {
    const first = await getOrCreateWork(makeWorkInput());
    const second = await getOrCreateWork(makeWorkInput());
    expect(second.id).toBe(first.id);
    const all = await db.works.toArray();
    expect(all).toHaveLength(1);
  });

  it("matches by platform_url when provided, even if title differs", async () => {
    const first = await getOrCreateWork(makeWorkInput({ platform_url: "https://kakuyomu.jp/works/123" }));
    const second = await getOrCreateWork(makeWorkInput({
      title: "タイトル違う",
      platform_url: "https://kakuyomu.jp/works/123",
    }));
    expect(second.id).toBe(first.id);
  });

  it("back-fills platform_url on existing work when missing", async () => {
    const first = await getOrCreateWork(makeWorkInput()); // no platform_url
    const second = await getOrCreateWork(makeWorkInput({ platform_url: "https://kakuyomu.jp/works/999" }));
    expect(second.id).toBe(first.id);
    const stored = await db.works.get(first.id);
    expect(stored!.platform_url).toBe("https://kakuyomu.jp/works/999");
  });

  it("creates separate works for different title+author combinations", async () => {
    await getOrCreateWork(makeWorkInput({ title: "作品A" }));
    await getOrCreateWork(makeWorkInput({ title: "作品B" }));
    const all = await db.works.toArray();
    expect(all).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ingestChapter", () => {
  beforeEach(clearDb);

  it("creates a chapter with correct fields", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({
      work_id: work.id,
      chapter_number: 1,
      title: "第一話：はじまり",
      full_text: "空は青く、風は静かだった。彼女はそこに立っていた。",
    });
    expect(chapter.work_id).toBe(work.id);
    expect(chapter.chapter_number).toBe(1);
    expect(chapter.title).toBe("第一話：はじまり");
    expect(chapter.full_text).toBe("空は青く、風は静かだった。彼女はそこに立っていた。");
    expect(chapter.id).toBeTruthy();
  });

  it("stores the chapter in the database", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({ work_id: work.id, chapter_number: 1, title: "一章", full_text: "テキスト" });
    const stored = await db.chapters.get(chapter.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(chapter.id);
  });

  it("creates chunks for the chapter", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({
      work_id: work.id,
      chapter_number: 1,
      title: "一章",
      full_text: "段落一。\n\n段落二。\n\n段落三。",
    });
    const chunks = await db.chunks.where("chapter_id").equals(chapter.id).toArray();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chapter.chunk_ids).toHaveLength(chunks.length);
  });

  it("chunk_ids match the actual chunks in DB", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({
      work_id: work.id,
      chapter_number: 1,
      title: "一章",
      full_text: "あ".repeat(1000),
    });
    const chunks = await db.chunks.where("chapter_id").equals(chapter.id).toArray();
    const chunkIds = chunks.map(c => c.id).sort();
    expect(chapter.chunk_ids.sort()).toEqual(chunkIds);
  });

  it("re-ingesting the same chapter_number replaces old chunks", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const first = await ingestChapter({ work_id: work.id, chapter_number: 1, title: "v1", full_text: "最初のテキスト" });
    const firstChunkCount = await db.chunks.where("chapter_id").equals(first.id).count();

    await ingestChapter({ work_id: work.id, chapter_number: 1, title: "v2", full_text: "更新されたテキスト" });

    // Same chapter id, same chapter number
    const chapters = await db.chapters.where("work_id").equals(work.id).toArray();
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("v2");

    const newChunkCount = await db.chunks.where("chapter_id").equals(first.id).count();
    // Old chunks should be gone; new chunks should exist
    expect(newChunkCount).toBeGreaterThan(0);
    // Total chunks for this chapter should not accumulate old ones
    const totalChunks = await db.chunks.where("chapter_id").equals(first.id).toArray();
    expect(totalChunks.every(c => c.text.includes("更新"))).toBe(true);
    void firstChunkCount; // used for context
  });

  it("different chapter_numbers create separate chapters", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    await ingestChapter({ work_id: work.id, chapter_number: 1, title: "一章", full_text: "テキスト1" });
    await ingestChapter({ work_id: work.id, chapter_number: 2, title: "二章", full_text: "テキスト2" });
    const chapters = await db.chapters.where("work_id").equals(work.id).toArray();
    expect(chapters).toHaveLength(2);
  });

  it("initializes empty arrays for analysis fields", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({ work_id: work.id, chapter_number: 1, title: "一章", full_text: "テキスト" });
    expect(chapter.appearing_characters).toEqual([]);
    expect(chapter.mentioned_characters).toEqual([]);
    expect(chapter.key_events).toEqual([]);
    expect(chapter.summary_ultra).toBe("");
    expect(chapter.summary_short).toBe("");
    expect(chapter.summary_medium).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("listWorks", () => {
  beforeEach(clearDb);

  it("returns empty array when no works exist", async () => {
    const result = await listWorks();
    expect(result).toEqual([]);
  });

  it("returns all works", async () => {
    await getOrCreateWork(makeWorkInput({ title: "作品A" }));
    await getOrCreateWork(makeWorkInput({ title: "作品B" }));
    const result = await listWorks();
    expect(result).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("listChapters", () => {
  beforeEach(clearDb);

  it("returns empty array when no chapters exist", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const result = await listChapters(work.id);
    expect(result).toEqual([]);
  });

  it("returns chapters ordered by chapter_number", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    await ingestChapter({ work_id: work.id, chapter_number: 3, title: "三章", full_text: "c" });
    await ingestChapter({ work_id: work.id, chapter_number: 1, title: "一章", full_text: "a" });
    await ingestChapter({ work_id: work.id, chapter_number: 2, title: "二章", full_text: "b" });
    const result = await listChapters(work.id);
    expect(result.map(c => c.chapter_number)).toEqual([1, 2, 3]);
  });

  it("returns only chapters for the given work_id", async () => {
    const workA = await getOrCreateWork(makeWorkInput({ title: "作品A" }));
    const workB = await getOrCreateWork(makeWorkInput({ title: "作品B" }));
    await ingestChapter({ work_id: workA.id, chapter_number: 1, title: "一章", full_text: "A" });
    await ingestChapter({ work_id: workB.id, chapter_number: 1, title: "一章", full_text: "B" });
    const resultA = await listChapters(workA.id);
    const resultB = await listChapters(workB.id);
    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(1);
    expect(resultA[0].work_id).toBe(workA.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("deleteWork", () => {
  beforeEach(clearDb);

  it("removes the work from the database", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    await deleteWork(work.id);
    const stored = await db.works.get(work.id);
    expect(stored).toBeUndefined();
  });

  it("removes all chapters and chunks for the work", async () => {
    const work = await getOrCreateWork(makeWorkInput());
    const chapter = await ingestChapter({ work_id: work.id, chapter_number: 1, title: "一章", full_text: "テキスト" });

    await deleteWork(work.id);

    const storedChapter = await db.chapters.get(chapter.id);
    expect(storedChapter).toBeUndefined();

    const chunks = await db.chunks.where("chapter_id").equals(chapter.id).toArray();
    expect(chunks).toHaveLength(0);
  });

  it("does not affect other works", async () => {
    const workA = await getOrCreateWork(makeWorkInput({ title: "作品A" }));
    const workB = await getOrCreateWork(makeWorkInput({ title: "作品B" }));
    await ingestChapter({ work_id: workB.id, chapter_number: 1, title: "一章", full_text: "テキスト" });

    await deleteWork(workA.id);

    const storedB = await db.works.get(workB.id);
    expect(storedB).toBeDefined();
    const chaptersB = await listChapters(workB.id);
    expect(chaptersB).toHaveLength(1);
  });

  it("does not throw when deleting a non-existent work", async () => {
    await expect(deleteWork("ghost-id")).resolves.not.toThrow();
  });
});

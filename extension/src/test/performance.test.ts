import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/storage";
import {
  createPerformanceSession,
  appendSegment,
  appendUserLine,
  listPerformanceSessions,
  deletePerformanceSession,
  getPlanForSession,
  updatePlan,
} from "@/lib/performance";
import type { ProductionPlan } from "@/lib/storage";

async function clearDb() {
  await db.performance_sessions.clear();
  await db.production_plans.clear();
}

const WORK_ID = "work-perf-001";
const CHAR_IDS = ["char-001", "char-002"];

describe("createPerformanceSession", () => {
  beforeEach(clearDb);

  it("creates a session with correct initial values", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 5, "moderate");
    expect(s.work_id).toBe(WORK_ID);
    expect(s.characters_in_scene).toEqual(CHAR_IDS);
    expect(s.mode).toBe("director");
    expect(s.cutoff_chapter).toBe(5);
    expect(s.improvisation_setting).toBe("moderate");
    expect(s.scene_progress).toBe(0);
    expect(s.generated_content).toEqual([]);
    expect(s.id).toBeTruthy();
  });

  it("stores the session in the database", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "screenwriter", 3, "strict");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(s.id);
  });

  it("sets user_character_id for cast mode", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "cast", 1, "free", "char-001");
    expect(s.user_character_id).toBe("char-001");
  });

  it("leaves user_character_id undefined when not provided", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    expect(s.user_character_id).toBeUndefined();
  });

  it("each session gets a unique id", async () => {
    const a = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const b = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    expect(a.id).not.toBe(b.id);
  });
});

describe("appendSegment", () => {
  beforeEach(clearDb);

  it("appends a segment to generated_content", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await appendSegment(s.id, "第一幕: 二人が出会う。");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.generated_content).toHaveLength(1);
    expect(stored!.generated_content[0].content).toBe("第一幕: 二人が出会う。");
  });

  it("preserves existing segments when appending", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await appendSegment(s.id, "Scene 1");
    await appendSegment(s.id, "Scene 2");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.generated_content).toHaveLength(2);
    expect(stored!.generated_content[1].content).toBe("Scene 2");
  });

  it("updates last_active timestamp", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const before = s.last_active;
    await new Promise(r => setTimeout(r, 5));
    await appendSegment(s.id, "content");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.last_active).toBeGreaterThanOrEqual(before);
  });

  it("assigns a unique segment_id to each segment", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await appendSegment(s.id, "A");
    await appendSegment(s.id, "B");
    const stored = await db.performance_sessions.get(s.id);
    const ids = stored!.generated_content.map(seg => seg.segment_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("stores debug_prompt when provided", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await appendSegment(s.id, "content", "debug-prompt-text");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.generated_content[0].debug_prompt).toBe("debug-prompt-text");
  });

  it("does nothing if session does not exist", async () => {
    await expect(appendSegment("no-such-session", "content")).resolves.not.toThrow();
  });
});

describe("appendUserLine", () => {
  beforeEach(clearDb);

  it("appends a user_line segment", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "cast", 1, "moderate", "char-001");
    await appendUserLine(s.id, "田中", "私はここにいます。");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.generated_content).toHaveLength(1);
    const seg = stored!.generated_content[0];
    expect(seg.segment_type).toBe("user_line");
    expect(seg.speaker_name).toBe("田中");
    expect(seg.content).toBe("私はここにいます。");
  });

  it("can interleave with generated segments", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "cast", 1, "moderate");
    await appendSegment(s.id, "LLM response 1");
    await appendUserLine(s.id, "ユーザー", "user line");
    await appendSegment(s.id, "LLM response 2");
    const stored = await db.performance_sessions.get(s.id);
    expect(stored!.generated_content).toHaveLength(3);
    expect(stored!.generated_content[1].segment_type).toBe("user_line");
  });
});

describe("listPerformanceSessions", () => {
  beforeEach(clearDb);

  it("returns empty array when no sessions exist", async () => {
    const result = await listPerformanceSessions("no-such-work");
    expect(result).toEqual([]);
  });

  it("returns only sessions for the given work_id", async () => {
    await createPerformanceSession("work-A", CHAR_IDS, "director", 1, "moderate");
    await createPerformanceSession("work-A", CHAR_IDS, "director", 1, "moderate");
    await createPerformanceSession("work-B", CHAR_IDS, "director", 1, "moderate");
    const resultA = await listPerformanceSessions("work-A");
    const resultB = await listPerformanceSessions("work-B");
    expect(resultA).toHaveLength(2);
    expect(resultB).toHaveLength(1);
    expect(resultA.every(s => s.work_id === "work-A")).toBe(true);
  });

  it("returns most recent session first", async () => {
    const first = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await new Promise(r => setTimeout(r, 5));
    const second = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const result = await listPerformanceSessions(WORK_ID);
    expect(result[0].id).toBe(second.id);
    expect(result[1].id).toBe(first.id);
  });
});

describe("deletePerformanceSession", () => {
  beforeEach(clearDb);

  it("removes the session from the database", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    await deletePerformanceSession(s.id);
    const stored = await db.performance_sessions.get(s.id);
    expect(stored).toBeUndefined();
  });

  it("does not throw when deleting a non-existent session", async () => {
    await expect(deletePerformanceSession("ghost-id")).resolves.not.toThrow();
  });
});

describe("getPlanForSession + updatePlan", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("returns undefined when no plan exists", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const plan = await getPlanForSession(s.id);
    expect(plan).toBeUndefined();
  });

  it("retrieves the plan by session id", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const plan: ProductionPlan = {
      id: crypto.randomUUID(),
      performance_session_id: s.id,
      created_at: Date.now(),
      who: ["キャラA", "キャラB"],
      where: "学校の屋上",
      when: "放課後",
      what: "二人の初めての会話",
      why: "運命の出会い",
      how: "偶然の出会い",
      props: [],
      tone_tags: ["romantic", "tender"],
      beats: [{ order: 1, description: "出会い" }],
      scene_basis: "extension",
      canonicity: "extension",
    };
    await db.production_plans.add(plan);
    const retrieved = await getPlanForSession(s.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(plan.id);
    expect(retrieved!.where).toBe("学校の屋上");
  });

  it("updatePlan persists changes", async () => {
    const s = await createPerformanceSession(WORK_ID, CHAR_IDS, "director", 1, "moderate");
    const plan: ProductionPlan = {
      id: crypto.randomUUID(),
      performance_session_id: s.id,
      created_at: Date.now(),
      who: ["A"],
      where: "旧教室",
      when: "昼",
      what: "探索",
      why: "謎を解く",
      how: "一人で",
      props: [],
      tone_tags: [],
      beats: [],
      scene_basis: "spinoff",
      canonicity: "speculation",
    };
    await db.production_plans.add(plan);
    await updatePlan(plan.id, { where: "図書館", tone_tags: ["mystery"] });
    const updated = await getPlanForSession(s.id);
    expect(updated!.where).toBe("図書館");
    expect(updated!.tone_tags).toEqual(["mystery"]);
    expect(updated!.what).toBe("探索"); // unchanged
  });
});

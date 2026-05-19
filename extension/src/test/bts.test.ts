import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/storage";
import {
  createBtsSession,
  appendBtsTurn,
  listBtsSessions,
} from "@/lib/bts";
import type { BtsTurn } from "@/lib/storage";

async function clearDb() {
  await db.bts_sessions.clear();
}

const WORK_ID = "work-bts-001";
const SKILL_IDS = ["skill-001", "skill-002"];

describe("createBtsSession", () => {
  beforeEach(clearDb);

  it("creates a session with correct initial values", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    expect(s.work_id).toBe(WORK_ID);
    expect(s.present_performers).toEqual(SKILL_IDS);
    expect(s.location).toBe("rest_area");
    expect(s.conversation_history).toEqual([]);
    expect(s.present_crew).toEqual([]);
    expect(s.id).toBeTruthy();
  });

  it("stores the session in the database", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    const stored = await db.bts_sessions.get(s.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(s.id);
  });

  it("accepts custom location", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS, "makeup_room");
    expect(s.location).toBe("makeup_room");
  });

  it("accepts crew members", async () => {
    const crew = [{ role: "監督", name: "田中監督", persona_snippet: "厳しいが優しい" }];
    const s = await createBtsSession(WORK_ID, SKILL_IDS, "set", crew);
    expect(s.present_crew).toHaveLength(1);
    expect(s.present_crew[0].name).toBe("田中監督");
  });

  it("each session gets a unique id", async () => {
    const a = await createBtsSession(WORK_ID, SKILL_IDS);
    const b = await createBtsSession(WORK_ID, SKILL_IDS);
    expect(a.id).not.toBe(b.id);
  });
});

describe("appendBtsTurn", () => {
  beforeEach(clearDb);

  it("appends a turn to conversation_history", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    const turn: BtsTurn = {
      speaker_skill_id: "skill-001",
      content: "やあ、調子はどう？",
      timestamp: Date.now(),
    };
    await appendBtsTurn(s.id, turn);
    const stored = await db.bts_sessions.get(s.id);
    expect(stored!.conversation_history).toHaveLength(1);
    expect(stored!.conversation_history[0].content).toBe("やあ、調子はどう？");
    expect(stored!.conversation_history[0].speaker_skill_id).toBe("skill-001");
  });

  it("preserves existing turns when appending", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    const t1: BtsTurn = { speaker_skill_id: "skill-001", content: "Hello", timestamp: Date.now() };
    const t2: BtsTurn = { speaker_skill_id: "skill-002", content: "こんにちは", timestamp: Date.now() };
    await appendBtsTurn(s.id, t1);
    await appendBtsTurn(s.id, t2);
    const stored = await db.bts_sessions.get(s.id);
    expect(stored!.conversation_history).toHaveLength(2);
    expect(stored!.conversation_history[1].content).toBe("こんにちは");
  });

  it("updates last_active timestamp", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    const before = s.last_active;
    await new Promise(r => setTimeout(r, 5));
    const turn: BtsTurn = { speaker_skill_id: "skill-001", content: "test", timestamp: Date.now() };
    await appendBtsTurn(s.id, turn);
    const stored = await db.bts_sessions.get(s.id);
    expect(stored!.last_active).toBeGreaterThanOrEqual(before);
  });

  it("supports turn_type field", async () => {
    const s = await createBtsSession(WORK_ID, SKILL_IDS);
    const turn: BtsTurn = {
      speaker_skill_id: "skill-001",
      content: "伸びをする",
      timestamp: Date.now(),
      turn_type: "action",
    };
    await appendBtsTurn(s.id, turn);
    const stored = await db.bts_sessions.get(s.id);
    expect(stored!.conversation_history[0].turn_type).toBe("action");
  });
});

describe("listBtsSessions", () => {
  beforeEach(clearDb);

  it("returns empty array when no sessions exist", async () => {
    const result = await listBtsSessions("no-such-work");
    expect(result).toEqual([]);
  });

  it("returns only sessions for the given work_id", async () => {
    await createBtsSession("work-A", SKILL_IDS);
    await createBtsSession("work-A", SKILL_IDS);
    await createBtsSession("work-B", SKILL_IDS);
    const resultA = await listBtsSessions("work-A");
    const resultB = await listBtsSessions("work-B");
    expect(resultA).toHaveLength(2);
    expect(resultB).toHaveLength(1);
    expect(resultA.every(s => s.work_id === "work-A")).toBe(true);
  });

  it("returns most recent session first", async () => {
    const first = await createBtsSession(WORK_ID, SKILL_IDS);
    await new Promise(r => setTimeout(r, 5));
    const second = await createBtsSession(WORK_ID, SKILL_IDS);
    const result = await listBtsSessions(WORK_ID);
    expect(result[0].id).toBe(second.id);
    expect(result[1].id).toBe(first.id);
  });
});

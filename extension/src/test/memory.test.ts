import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/storage";
import {
  createNewSession,
  addTurn,
  listSessions,
  deleteSession,
  buildSessionContext,
  sessionToMessages,
} from "@/lib/memory";
import type { Turn, Tier1Summary } from "@/lib/storage";

async function clearDb() {
  await db.sessions.clear();
  await db.works.clear();
}

const WORK_ID = "work-test-001";
const CHAR_ID = "char-test-001";

describe("createNewSession", () => {
  beforeEach(clearDb);

  it("creates a session with correct initial values", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 3);
    expect(s.work_id).toBe(WORK_ID);
    expect(s.character_id).toBe(CHAR_ID);
    expect(s.cutoff_chapter).toBe(3);
    expect(s.mode).toBe("reader");
    expect(s.tier_0_recent_turns).toEqual([]);
    expect(s.tier_1_paragraph_summaries).toEqual([]);
    expect(s.id).toBeTruthy();
  });

  it("stores the session in the database", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    const stored = await db.sessions.get(s.id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(s.id);
  });

  it("accepts author mode", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 5, "author");
    expect(s.mode).toBe("author");
  });

  it("stores character_version_id when provided", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 2, "reader", "ver-abc");
    expect(s.character_version_id).toBe("ver-abc");
  });
});

describe("addTurn", () => {
  beforeEach(clearDb);

  it("appends a user turn to the session", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    const turn: Turn = { role: "user", content: "こんにちは", timestamp: Date.now() };
    await addTurn(s.id, turn);
    const updated = await db.sessions.get(s.id);
    expect(updated!.tier_0_recent_turns).toHaveLength(1);
    expect(updated!.tier_0_recent_turns[0].content).toBe("こんにちは");
  });

  it("appends a character turn", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    await addTurn(s.id, { role: "user", content: "おはよう", timestamp: Date.now() });
    await addTurn(s.id, { role: "character", content: "おはようございます", timestamp: Date.now() });
    const updated = await db.sessions.get(s.id);
    expect(updated!.tier_0_recent_turns).toHaveLength(2);
    expect(updated!.tier_0_recent_turns[1].role).toBe("character");
  });

  it("updates last_active timestamp", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    const before = s.last_active;
    await new Promise(r => setTimeout(r, 5));
    await addTurn(s.id, { role: "user", content: "test", timestamp: Date.now() });
    const updated = await db.sessions.get(s.id);
    expect(updated!.last_active).toBeGreaterThanOrEqual(before);
  });

  it("throws if session does not exist", async () => {
    await expect(
      addTurn("non-existent-id", { role: "user", content: "x", timestamp: Date.now() })
    ).rejects.toThrow("Session not found");
  });
});

describe("listSessions", () => {
  beforeEach(clearDb);

  it("returns empty array when no sessions exist", async () => {
    const result = await listSessions("unknown-work");
    expect(result).toEqual([]);
  });

  it("returns only sessions for the given work_id", async () => {
    await createNewSession("work-A", CHAR_ID, 1);
    await createNewSession("work-A", CHAR_ID, 2);
    await createNewSession("work-B", CHAR_ID, 1);

    const sessionsA = await listSessions("work-A");
    const sessionsB = await listSessions("work-B");

    expect(sessionsA).toHaveLength(2);
    expect(sessionsB).toHaveLength(1);
    expect(sessionsA.every(s => s.work_id === "work-A")).toBe(true);
  });
});

describe("deleteSession", () => {
  beforeEach(clearDb);

  it("removes the session from the database", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    await deleteSession(s.id);
    const stored = await db.sessions.get(s.id);
    expect(stored).toBeUndefined();
  });

  it("does not throw when deleting a non-existent session", async () => {
    await expect(deleteSession("ghost-id")).resolves.not.toThrow();
  });
});

describe("buildSessionContext", () => {
  it("returns empty string when no summaries or facts", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    const ctx = await buildSessionContext(s);
    expect(ctx).toBe("");
  });

  it("includes tier1 summary text", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    const summary: Tier1Summary = {
      turns: [0, 9],
      topic: "greeting",
      key_exchanges: ["読者がキャラクターに挨拶した。"],
      emotional_state_change: { before: "neutral", after: "happy" },
      new_facts_established: [],
    };
    s.tier_1_paragraph_summaries = [summary];
    const ctx = await buildSessionContext(s);
    expect(ctx).toContain("これまでの会話の要約");
    expect(ctx).toContain("読者がキャラクターに挨拶した。");
  });

  it("includes established facts", async () => {
    const s = await createNewSession(WORK_ID, CHAR_ID, 1);
    s.established_facts = [{ fact: "主人公は勇者だ", turn: 3, topic_tags: ["hero"] }];
    const ctx = await buildSessionContext(s);
    expect(ctx).toContain("確立された事実");
    expect(ctx).toContain("主人公は勇者だ");
  });
});

describe("sessionToMessages", () => {
  it("maps user turns to role user", () => {
    const s = {
      tier_0_recent_turns: [
        { role: "user" as const, content: "hello", timestamp: 1 },
      ],
    } as Parameters<typeof sessionToMessages>[0];
    const msgs = sessionToMessages(s as any);
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
  });

  it("maps character turns to role assistant", () => {
    const s = {
      tier_0_recent_turns: [
        { role: "character" as const, content: "こんにちは", timestamp: 1 },
      ],
    } as Parameters<typeof sessionToMessages>[0];
    const msgs = sessionToMessages(s as any);
    expect(msgs[0]).toEqual({ role: "assistant", content: "こんにちは" });
  });

  it("preserves order of turns", () => {
    const s = {
      tier_0_recent_turns: [
        { role: "user" as const, content: "A", timestamp: 1 },
        { role: "character" as const, content: "B", timestamp: 2 },
        { role: "user" as const, content: "C", timestamp: 3 },
      ],
    };
    const msgs = sessionToMessages(s as any);
    expect(msgs.map(m => m.content)).toEqual(["A", "B", "C"]);
    expect(msgs.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("returns empty array for empty session", () => {
    const s = { tier_0_recent_turns: [] };
    expect(sessionToMessages(s as any)).toEqual([]);
  });
});

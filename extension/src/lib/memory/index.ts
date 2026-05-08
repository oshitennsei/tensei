import { db } from "@/lib/storage";
import type { Session, Turn, Tier1Summary } from "@/lib/storage";
import { LlmClient } from "@/lib/llm";

const TIER0_MAX_TURNS = 20;
const TIER1_COMPRESS_EVERY = 10; // compress after every N tier-0 turns

export async function createNewSession(
  work_id: string,
  character_id: string,
  cutoff_chapter: number,
  mode: Session["mode"] = "reader",
  character_version_id?: string,
): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    work_id,
    character_id,
    ...(character_version_id ? { character_version_id } : {}),
    mode,
    cutoff_chapter,
    started_at: Date.now(),
    last_active: Date.now(),
    tier_0_recent_turns: [],
    tier_1_paragraph_summaries: [],
    tier_2_chapter_summaries: [],
    session_summary: "",
    established_facts: [],
    emotional_arc: "",
    session_events: [],
    reader_profile_in_session: "",
  };
  await db.sessions.add(session);
  return session;
}

export async function getOrCreateSession(
  work_id: string,
  character_id: string,
  cutoff_chapter: number,
  mode: Session["mode"] = "reader"
): Promise<Session> {
  const existing = await db.sessions
    .where("[work_id+character_id]")
    .equals([work_id, character_id])
    .filter(s => s.cutoff_chapter === cutoff_chapter)
    .first();
  if (existing) return existing;

  const session: Session = {
    id: crypto.randomUUID(),
    work_id,
    character_id,
    mode,
    cutoff_chapter,
    started_at: Date.now(),
    last_active: Date.now(),
    tier_0_recent_turns: [],
    tier_1_paragraph_summaries: [],
    tier_2_chapter_summaries: [],
    session_summary: "",
    established_facts: [],
    emotional_arc: "",
    session_events: [],
    reader_profile_in_session: "",
  };
  await db.sessions.add(session);
  return session;
}

export async function addTurn(session_id: string, turn: Turn): Promise<void> {
  const session = await db.sessions.get(session_id);
  if (!session) throw new Error("Session not found");

  const turns = [...session.tier_0_recent_turns, turn];
  await db.sessions.update(session_id, {
    tier_0_recent_turns: turns,
    last_active: Date.now(),
  });

  if (turns.length >= TIER1_COMPRESS_EVERY * 2) {
    await compressTier0(session_id);
  }
}

export async function compressTier0(session_id: string): Promise<void> {
  const session = await db.sessions.get(session_id);
  if (!session || session.tier_0_recent_turns.length < TIER1_COMPRESS_EVERY) return;

  const client = await LlmClient.forRole("compression");
  if (!client) return; // no compression LLM configured, skip silently

  const toCompress = session.tier_0_recent_turns.slice(0, TIER1_COMPRESS_EVERY);
  const remaining = session.tier_0_recent_turns.slice(TIER1_COMPRESS_EVERY);

  const turnText = toCompress
    .map(t => `${t.role === "user" ? "読者" : "キャラクター"}: ${t.content}`)
    .join("\n");

  const summary = await client.complete([
    {
      role: "system",
      content: "次の会話を簡潔に要約してください。重要なやり取り、確立された事実、感情の変化を含めてください。",
    },
    { role: "user", content: turnText },
  ]);

  const tier1: Tier1Summary = {
    turns: [
      session.tier_0_recent_turns.length - toCompress.length,
      session.tier_0_recent_turns.length - 1,
    ],
    topic: "",
    key_exchanges: [summary],
    emotional_state_change: { before: "", after: "" },
    new_facts_established: [],
  };

  await db.sessions.update(session_id, {
    tier_0_recent_turns: remaining,
    tier_1_paragraph_summaries: [...session.tier_1_paragraph_summaries, tier1],
  });
}

export async function buildSessionContext(session: Session): Promise<string> {
  const parts: string[] = [];

  if (session.tier_1_paragraph_summaries.length > 0) {
    const summaries = session.tier_1_paragraph_summaries
      .map(s => s.key_exchanges.join(" "))
      .join("\n");
    parts.push(`## これまでの会話の要約\n${summaries}`);
  }

  if (session.established_facts.length > 0) {
    parts.push(
      "## 確立された事実\n" +
        session.established_facts.map(f => `- ${f.fact}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

export function sessionToMessages(session: Session): Array<{ role: "user" | "assistant"; content: string }> {
  return session.tier_0_recent_turns.map(t => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.content,
  }));
}

export async function listSessions(work_id: string): Promise<Session[]> {
  return db.sessions
    .where("work_id")
    .equals(work_id)
    .reverse()
    .sortBy("last_active");
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

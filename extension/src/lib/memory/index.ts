import { db } from "@/lib/storage";
import type { Session, Turn, Tier1Summary } from "@/lib/storage";
import { LlmClient } from "@/lib/llm";
import { getStrings, langFromStorage } from "@/lib/i18n";

const COMPRESSION_TRIGGER = 10; // compress when tier-0 has this many turns
const COMPRESSION_KEEP_RAW = 4; // keep this many recent turns outside compression

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

  // Trigger background compression if threshold exceeded (fire and forget)
  if (turns.length >= COMPRESSION_TRIGGER && !session.compression_in_progress) {
    compressTier0(session_id).catch(() => {});
  }
}

export async function compressTier0(session_id: string): Promise<void> {
  const session = await db.sessions.get(session_id);
  if (!session || session.compression_in_progress) return;
  if (session.tier_0_recent_turns.length < COMPRESSION_TRIGGER) return;

  await db.sessions.update(session_id, { compression_in_progress: true });

  try {
    const client = await LlmClient.forRole("compression") ?? await LlmClient.forRole("main");
    if (!client) {
      await db.sessions.update(session_id, { compression_in_progress: false });
      return;
    }

    const appSettings = await db.app_settings.get("global");
    const s = getStrings(langFromStorage(appSettings?.ui_language));

    // Compress all but the most recent COMPRESSION_KEEP_RAW turns
    const fresh = await db.sessions.get(session_id);
    if (!fresh) return;

    const toCompress = fresh.tier_0_recent_turns.slice(0, -COMPRESSION_KEEP_RAW);
    const remaining = fresh.tier_0_recent_turns.slice(-COMPRESSION_KEEP_RAW);
    if (toCompress.length === 0) {
      await db.sessions.update(session_id, { compression_in_progress: false });
      return;
    }

    // Build compression input: previous summaries + new turns to compress
    const parts: string[] = [];
    if (fresh.tier_1_paragraph_summaries.length > 0) {
      const prevSummary = fresh.tier_1_paragraph_summaries
        .map(s => s.key_exchanges.join(" "))
        .join("\n");
      parts.push(`${s.compression_context_label}\n${prevSummary}`);
    }
    parts.push(toCompress
      .map(t => `${t.role === "user" ? "讀者" : "角色"}: ${t.content}`)
      .join("\n")
    );

    const summary = await client.complete([
      { role: "system", content: s.compression_system },
      { role: "user", content: parts.join("\n\n") },
    ]);

    const tier1: Tier1Summary = {
      turns: [0, fresh.tier_0_recent_turns.length - COMPRESSION_KEEP_RAW - 1],
      topic: "",
      key_exchanges: [summary],
      emotional_state_change: { before: "", after: "" },
      new_facts_established: [],
    };

    await db.sessions.update(session_id, {
      tier_0_recent_turns: remaining,
      // Replace all previous summaries with the new merged one
      tier_1_paragraph_summaries: [tier1],
      compression_in_progress: false,
    });
  } catch {
    await db.sessions.update(session_id, { compression_in_progress: false });
  }
}

export async function buildSessionContext(session: Session): Promise<string> {
  const appSettings = await db.app_settings.get("global");
  const s = getStrings(langFromStorage(appSettings?.ui_language));
  const parts: string[] = [];

  if (session.tier_1_paragraph_summaries.length > 0) {
    const summaries = session.tier_1_paragraph_summaries
      .map(s => s.key_exchanges.join(" "))
      .join("\n");
    parts.push(`${s.compression_context_label}\n${summaries}`);
  }

  if (session.established_facts.length > 0) {
    parts.push(
      "## 確立された事実\n" +
        session.established_facts.map(f => `- ${f.fact}`).join("\n")
    );
  }

  return parts.join("\n\n");
}

function stripOOC(text: string): string {
  return text.replace(/\(([^)]+)\)/g, "").replace(/\s+/g, " ").trim();
}

export function sessionToMessages(session: Session): Array<{ role: "user" | "assistant"; content: string }> {
  return session.tier_0_recent_turns.map(t => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.role === "user" ? stripOOC(t.content) : t.content,
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

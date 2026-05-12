import { Hono, type Context } from "hono";
import type { Env } from "../index";
import { nanoid } from "../lib/id";

type LockedField = "persona" | "speech_style" | "will_not_do" | "forbidden_topics";

interface CharacterData {
  persona?: string;
  speech_style?: string;
  will_do?: string[];
  will_not_do?: string[];
  forbidden_topics?: string[];
  voice_samples?: Array<{ context: string; line: string; chapter?: number }>;
  dialogue_examples?: Array<{ context: string; user_message_pattern: string; ideal_response: string; notes?: string }>;
  state_snapshots?: unknown[];
}

interface PutCharacterBody {
  name: string;
  data: CharacterData;
  locked_fields: LockedField[];
}

interface PutSummaryBody {
  summary: string;
  locked?: boolean;
}

export const worksContentRoutes = new Hono<{ Bindings: Env }>();

async function resolveAuthor(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const bearer = (c.req.header("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!bearer) return null;
  return c.env.MAGIC_LINK_KV.get(`sess:${bearer}`);
}

async function checkOwnership(
  c: Context<{ Bindings: Env }>,
  workId: string,
): Promise<{ ok: true; authorId: string } | { ok: false; response: Response }> {
  const authorId = await resolveAuthor(c);
  if (!authorId) return { ok: false, response: c.json({ error: "Unauthorized" }, 401) };

  const work = await c.env.DB.prepare(
    "SELECT author_id FROM works WHERE id = ?",
  ).bind(workId).first<{ author_id: string }>();

  if (!work) return { ok: false, response: c.json({ error: "Not found" }, 404) };
  if (work.author_id !== authorId) return { ok: false, response: c.json({ error: "Forbidden" }, 403) };

  return { ok: true, authorId };
}

// ── GET /:work_id/characters ─────────────────────────────────────────────────

worksContentRoutes.get("/:work_id/characters", async (c) => {
  const workId = c.req.param("work_id");
  const work = await c.env.DB.prepare(
    "SELECT status FROM works WHERE id = ?",
  ).bind(workId).first<{ status: string }>();

  if (!work || work.status !== "approved") return c.json({ error: "Not found" }, 404);

  const rows = await c.env.DB.prepare(
    "SELECT id, work_id, slug, name, data, locked_fields, updated_at FROM characters WHERE work_id = ?",
  ).bind(workId).all<{ id: string; work_id: string; slug: string; name: string; data: string; locked_fields: string; updated_at: number }>();

  const characters = (rows.results ?? []).map(r => ({
    ...r,
    data: JSON.parse(r.data) as CharacterData,
    locked_fields: JSON.parse(r.locked_fields) as LockedField[],
  }));

  return c.json({ characters });
});

// ── PUT /:work_id/characters/:slug ───────────────────────────────────────────

worksContentRoutes.put("/:work_id/characters/:slug", async (c) => {
  const workId = c.req.param("work_id");
  const slug = c.req.param("slug");

  const ownership = await checkOwnership(c, workId);
  if (!ownership.ok) return ownership.response;

  const body = await c.req.json<PutCharacterBody>();
  if (!body.name?.trim()) return c.json({ error: "name required" }, 400);

  const now = Date.now();
  const id = nanoid();

  await c.env.DB.prepare(`
    INSERT INTO characters (id, work_id, slug, name, data, locked_fields, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_id, slug) DO UPDATE SET
      name=excluded.name, data=excluded.data,
      locked_fields=excluded.locked_fields, updated_at=excluded.updated_at
  `).bind(
    id, workId, slug, body.name.trim(),
    JSON.stringify(body.data ?? {}),
    JSON.stringify(body.locked_fields ?? []),
    now, now,
  ).run();

  const saved = await c.env.DB.prepare(
    "SELECT id, work_id, slug, name, data, locked_fields, updated_at FROM characters WHERE work_id = ? AND slug = ?",
  ).bind(workId, slug).first<{ id: string; work_id: string; slug: string; name: string; data: string; locked_fields: string; updated_at: number }>();

  return c.json({
    ok: true,
    character: saved ? {
      ...saved,
      data: JSON.parse(saved.data) as CharacterData,
      locked_fields: JSON.parse(saved.locked_fields) as LockedField[],
    } : null,
  });
});

// ── DELETE /:work_id/characters/:slug ────────────────────────────────────────

worksContentRoutes.delete("/:work_id/characters/:slug", async (c) => {
  const workId = c.req.param("work_id");
  const slug = c.req.param("slug");

  const ownership = await checkOwnership(c, workId);
  if (!ownership.ok) return ownership.response;

  const result = await c.env.DB.prepare(
    "DELETE FROM characters WHERE work_id = ? AND slug = ?",
  ).bind(workId, slug).run();

  if (!result.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── GET /:work_id/summaries ──────────────────────────────────────────────────

worksContentRoutes.get("/:work_id/summaries", async (c) => {
  const workId = c.req.param("work_id");
  const work = await c.env.DB.prepare(
    "SELECT status FROM works WHERE id = ?",
  ).bind(workId).first<{ status: string }>();

  if (!work || work.status !== "approved") return c.json({ error: "Not found" }, 404);

  const rows = await c.env.DB.prepare(
    "SELECT id, work_id, chapter_number, summary, locked, updated_at FROM chapter_summaries WHERE work_id = ? ORDER BY chapter_number ASC",
  ).bind(workId).all<{ id: string; work_id: string; chapter_number: number; summary: string; locked: number; updated_at: number }>();

  const summaries = (rows.results ?? []).map(r => ({
    ...r,
    locked: r.locked === 1,
  }));

  return c.json({ summaries });
});

// ── PUT /:work_id/summaries/:chapter_num ─────────────────────────────────────

worksContentRoutes.put("/:work_id/summaries/:chapter_num", async (c) => {
  const workId = c.req.param("work_id");
  const chapterNum = parseInt(c.req.param("chapter_num"), 10);
  if (isNaN(chapterNum) || chapterNum < 1) return c.json({ error: "Invalid chapter_num" }, 400);

  const ownership = await checkOwnership(c, workId);
  if (!ownership.ok) return ownership.response;

  const body = await c.req.json<PutSummaryBody>();
  if (typeof body.summary !== "string") return c.json({ error: "summary required" }, 400);

  const now = Date.now();
  const id = nanoid();
  const locked = body.locked ? 1 : 0;

  await c.env.DB.prepare(`
    INSERT INTO chapter_summaries (id, work_id, chapter_number, summary, locked, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_id, chapter_number) DO UPDATE SET
      summary=excluded.summary, locked=excluded.locked, updated_at=excluded.updated_at
  `).bind(id, workId, chapterNum, body.summary, locked, now, now).run();

  return c.json({ ok: true });
});

// ── DELETE /:work_id/summaries/:chapter_num ──────────────────────────────────

worksContentRoutes.delete("/:work_id/summaries/:chapter_num", async (c) => {
  const workId = c.req.param("work_id");
  const chapterNum = parseInt(c.req.param("chapter_num"), 10);
  if (isNaN(chapterNum)) return c.json({ error: "Invalid chapter_num" }, 400);

  const ownership = await checkOwnership(c, workId);
  if (!ownership.ok) return ownership.response;

  const result = await c.env.DB.prepare(
    "DELETE FROM chapter_summaries WHERE work_id = ? AND chapter_number = ?",
  ).bind(workId, chapterNum).run();

  if (!result.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

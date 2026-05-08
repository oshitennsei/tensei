import { Hono } from "hono";
import type { Env } from "../index";

export const statusRoutes = new Hono<{ Bindings: Env }>();

// GET /status/:author_id — poll registration status
statusRoutes.get("/:author_id", async (c) => {
  const author = await c.env.DB.prepare(
    "SELECT id, display_name, status, verify_code, note_url FROM authors WHERE id = ?",
  ).bind(c.req.param("author_id")).first<{
    id: string;
    display_name: string;
    status: string;
    verify_code: string;
    note_url: string | null;
  }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);

  const works = await c.env.DB.prepare(
    "SELECT id, title, platform, platform_url, slug, status FROM works WHERE author_id = ?",
  ).bind(author.id).all<{ id: string; title: string; platform: string; platform_url: string; slug: string; status: string }>();

  return c.json({
    author_id: author.id,
    display_name: author.display_name,
    status: author.status,
    verify_code: author.verify_code,
    note_url: author.note_url,
    works: works.results ?? [],
  });
});

// POST /status/:author_id/character — submit character config (approved authors only)
statusRoutes.post("/:author_id/character", async (c) => {
  const { commitCharacterConfig } = await import("../lib/github");

  const author = await c.env.DB.prepare(
    "SELECT id, status, github_handle FROM authors WHERE id = ?",
  ).bind(c.req.param("author_id")).first<{ id: string; status: string; github_handle: string | null }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);
  if (author.status !== "approved") return c.json({ error: "承認済みの著者のみキャラクターを提出できます。" }, 403);

  const body = await c.req.json<{ work_slug: string; character_slug: string; config: unknown }>();

  const configJson = JSON.stringify(body.config, null, 2);
  const handle = author.github_handle ?? author.id.slice(0, 8);
  const branchName = `author/${handle}/${body.character_slug}-${Date.now()}`;

  const prUrl = await commitCharacterConfig(
    c.env.GITHUB_TOKEN,
    c.env.GITHUB_REPO_OWNER,
    c.env.GITHUB_REPO_NAME,
    handle,
    body.work_slug,
    body.character_slug,
    configJson,
    branchName,
  );

  return c.json({ ok: true, pr_url: prUrl });
});

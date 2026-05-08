import { Hono } from "hono";
import type { Env } from "../index";
import { addAuthorToCODEOWNERS } from "../lib/github";
import { slugify } from "../lib/id";

export const adminRoutes = new Hono<{ Bindings: Env }>();

// Middleware: require Authorization: Bearer {ADMIN_SECRET}
adminRoutes.use("*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  if (auth !== `Bearer ${c.env.ADMIN_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// GET /admin/queue — list all pending_manual_review authors
adminRoutes.get("/queue", async (c) => {
  const authors = await c.env.DB.prepare(
    "SELECT id, email, display_name, status, verify_code, note_url, created_at FROM authors WHERE status IN ('pending_manual_review', 'email_verified') ORDER BY created_at ASC",
  ).all();
  return c.json({ authors: authors.results });
});

// GET /admin/all — list all authors
adminRoutes.get("/all", async (c) => {
  const authors = await c.env.DB.prepare(
    "SELECT id, email, display_name, github_handle, status, created_at, reviewed_at FROM authors ORDER BY created_at DESC",
  ).all();
  return c.json({ authors: authors.results });
});

// POST /admin/approve/:author_id
adminRoutes.post("/approve/:author_id", async (c) => {
  const body = await c.req.json<{ github_handle: string; admin_note?: string }>().catch(() => ({ github_handle: "" }));
  const handle = (body.github_handle ?? "").trim();

  const author = await c.env.DB.prepare(
    "SELECT id, email, display_name, status FROM authors WHERE id = ?",
  ).bind(c.req.param("author_id")).first<{ id: string; email: string; display_name: string; status: string }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);

  await c.env.DB.prepare(
    "UPDATE authors SET status = 'approved', github_handle = ?, admin_note = ?, reviewed_at = ? WHERE id = ?",
  ).bind(handle || null, body.admin_note ?? null, Date.now(), author.id).run();

  // Add to CODEOWNERS for each approved work
  const works = await c.env.DB.prepare(
    "SELECT slug FROM works WHERE author_id = ?",
  ).bind(author.id).all<{ slug: string }>();

  for (const work of (works.results ?? [])) {
    try {
      await addAuthorToCODEOWNERS(
        c.env.GITHUB_TOKEN,
        c.env.GITHUB_REPO_OWNER,
        c.env.GITHUB_REPO_NAME,
        handle,
        work.slug,
      );
      await c.env.DB.prepare(
        "UPDATE works SET status = 'approved', reviewed_at = ? WHERE slug = ?",
      ).bind(Date.now(), work.slug).run();
    } catch (e) {
      console.error("CODEOWNERS update failed:", e);
    }
  }

  return c.json({ ok: true });
});

// POST /admin/reject/:author_id
adminRoutes.post("/reject/:author_id", async (c) => {
  const body = await c.req.json<{ admin_note?: string }>().catch(() => ({}));

  await c.env.DB.prepare(
    "UPDATE authors SET status = 'rejected', admin_note = ?, reviewed_at = ? WHERE id = ?",
  ).bind(body.admin_note ?? null, Date.now(), c.req.param("author_id")).run();

  return c.json({ ok: true });
});

// POST /admin/works — create work slug for author (helper for CODEOWNERS)
adminRoutes.post("/works", async (c) => {
  const body = await c.req.json<{ author_id: string; title: string; platform: string; platform_url: string }>();
  const author = await c.env.DB.prepare("SELECT github_handle FROM authors WHERE id = ?")
    .bind(body.author_id).first<{ github_handle: string | null }>();
  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);

  const handle = author.github_handle ?? body.author_id.slice(0, 8);
  const slug = `${handle}-${slugify(body.title)}`;
  return c.json({ slug });
});

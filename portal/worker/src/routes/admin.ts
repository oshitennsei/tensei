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
  return next();
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
  const body = await c.req.json<{ github_handle?: string; admin_note?: string }>().catch(() => ({ github_handle: undefined, admin_note: undefined }));
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
    // Always approve the work; CODEOWNERS is best-effort
    await c.env.DB.prepare(
      "UPDATE works SET status = 'approved', reviewed_at = ? WHERE slug = ?",
    ).bind(Date.now(), work.slug).run();
    if (handle) {
      try {
        await addAuthorToCODEOWNERS(
          c.env.GITHUB_TOKEN,
          c.env.GITHUB_REPO_OWNER,
          c.env.GITHUB_REPO_NAME,
          handle,
          work.slug,
        );
      } catch (e) {
        console.error("CODEOWNERS update failed (non-fatal):", e);
      }
    }
  }

  return c.json({ ok: true });
});

// POST /admin/reject/:author_id
adminRoutes.post("/reject/:author_id", async (c) => {
  const body = await c.req.json<{ admin_note?: string }>().catch(() => ({ admin_note: undefined }));

  await c.env.DB.prepare(
    "UPDATE authors SET status = 'rejected', admin_note = ?, reviewed_at = ? WHERE id = ?",
  ).bind(body.admin_note ?? null, Date.now(), c.req.param("author_id")).run();

  return c.json({ ok: true });
});

// POST /admin/approve-work — directly approve a work by platform_url
adminRoutes.post("/approve-work", async (c) => {
  const body = await c.req.json<{ platform_url: string }>().catch(() => ({ platform_url: "" }));
  if (!body.platform_url) return c.json({ error: "platform_url required" }, 400);

  const result = await c.env.DB.prepare(
    "UPDATE works SET status = 'approved', reviewed_at = ? WHERE platform_url = ?",
  ).bind(Date.now(), body.platform_url).run();

  if (!result.meta.changes || result.meta.changes === 0) {
    return c.json({ error: "Work not found" }, 404);
  }
  return c.json({ ok: true, changes: result.meta.changes });
});

// GET /admin/check-note/:author_id — fetch note_url and verify verify_code is present
adminRoutes.get("/check-note/:author_id", async (c) => {
  const author = await c.env.DB.prepare(
    "SELECT verify_code, note_url FROM authors WHERE id = ?",
  ).bind(c.req.param("author_id")).first<{ verify_code: string; note_url: string | null }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);
  if (!author.note_url) return c.json({ verified: false, reason: "note_url未提出" });

  try {
    const res = await fetch(author.note_url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TenseiBot/1.0)" },
    });
    if (!res.ok) return c.json({ verified: false, reason: `ページ取得失敗 (${res.status})` });
    const html = await res.text();
    const found = html.includes(author.verify_code);
    return c.json({ verified: found, reason: found ? "コードを確認しました" : "コードが見つかりません" });
  } catch (e) {
    return c.json({ verified: false, reason: `取得エラー: ${String(e)}` });
  }
});

// GET /admin/pending-works — list works with pending_manual_review status
adminRoutes.get("/pending-works", async (c) => {
  const works = await c.env.DB.prepare(
    `SELECT w.id, w.title, w.platform, w.platform_url, w.slug, w.status, w.verify_snapshot, w.created_at,
            a.display_name as author_name, a.email as author_email
     FROM works w JOIN authors a ON a.id = w.author_id
     WHERE w.status = 'pending_manual_review' ORDER BY w.created_at ASC`,
  ).all();
  return c.json({ works: works.results });
});

// GET /admin/all-works — list all works with author info
adminRoutes.get("/all-works", async (c) => {
  const works = await c.env.DB.prepare(
    `SELECT w.id, w.title, w.platform, w.platform_url, w.slug, w.status, w.verify_snapshot, w.created_at,
            a.display_name as author_name, a.email as author_email
     FROM works w JOIN authors a ON a.id = w.author_id
     ORDER BY w.created_at DESC`,
  ).all();
  return c.json({ works: works.results });
});

// POST /admin/suspend-work — set work status to suspended
adminRoutes.post("/suspend-work", async (c) => {
  const body = await c.req.json<{ work_id: string }>().catch(() => ({ work_id: "" }));
  if (!body.work_id) return c.json({ error: "work_id required" }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE works SET status = 'suspended', reviewed_at = ? WHERE id = ?",
  ).bind(Date.now(), body.work_id).run();
  if (!result.meta.changes) return c.json({ error: "Work not found" }, 404);
  return c.json({ ok: true });
});

// POST /admin/restore-work — restore suspended work back to approved
adminRoutes.post("/restore-work", async (c) => {
  const body = await c.req.json<{ work_id: string }>().catch(() => ({ work_id: "" }));
  if (!body.work_id) return c.json({ error: "work_id required" }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE works SET status = 'approved', reviewed_at = ? WHERE id = ? AND status = 'suspended'",
  ).bind(Date.now(), body.work_id).run();
  if (!result.meta.changes) return c.json({ error: "Work not found or not suspended" }, 404);
  return c.json({ ok: true });
});

// POST /admin/delete-work — permanently delete a work
adminRoutes.post("/delete-work", async (c) => {
  const body = await c.req.json<{ work_id: string }>().catch(() => ({ work_id: "" }));
  if (!body.work_id) return c.json({ error: "work_id required" }, 400);
  const result = await c.env.DB.prepare(
    "DELETE FROM works WHERE id = ?",
  ).bind(body.work_id).run();
  if (!result.meta.changes) return c.json({ error: "Work not found" }, 404);
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

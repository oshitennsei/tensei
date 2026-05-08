import { Hono } from "hono";
import type { Env } from "../index";
import { nanoid, verifyCode } from "../lib/id";
import { sendMagicLink } from "../lib/email";

export const registerRoutes = new Hono<{ Bindings: Env }>();

// POST /register — start author registration
registerRoutes.post("/", async (c) => {
  const body = await c.req.json<{ email: string; display_name: string }>();
  const email = (body.email ?? "").toLowerCase().trim();
  const display_name = (body.display_name ?? "").trim();

  if (!email.includes("@")) return c.json({ error: "有効なメールアドレスを入力してください。" }, 400);
  if (!display_name) return c.json({ error: "表示名を入力してください。" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE email = ?",
  ).bind(email).first<{ id: string; status: string }>();

  if (existing) {
    if (existing.status === "approved") {
      return c.json({ error: "このメールアドレスはすでに承認済みです。" }, 409);
    }
    // Resend magic link for any non-approved state
    const code = verifyCode();
    const token = nanoid(32);
    const verifyUrl = `${c.env.FRONTEND_URL}/verify?token=${token}`;

    await c.env.MAGIC_LINK_KV.put(`ml:${token}`, JSON.stringify({ email, author_id: existing.id }), { expirationTtl: 600 });
    await c.env.DB.prepare("UPDATE authors SET verify_code = ? WHERE id = ?").bind(code, existing.id).run();
    await sendMagicLink(c.env.RESEND_API_KEY, email, verifyUrl, code);

    return c.json({ ok: true, message: "確認メールを再送しました。" });
  }

  const id = nanoid();
  const code = verifyCode();
  const token = nanoid(32);
  const verifyUrl = `${c.env.FRONTEND_URL}/verify?token=${token}`;

  await c.env.DB.prepare(
    "INSERT INTO authors (id, email, display_name, status, verify_code, created_at) VALUES (?, ?, ?, 'pending_email', ?, ?)",
  ).bind(id, email, display_name, code, Date.now()).run();

  await c.env.MAGIC_LINK_KV.put(`ml:${token}`, JSON.stringify({ email, author_id: id }), { expirationTtl: 600 });
  await sendMagicLink(c.env.RESEND_API_KEY, email, verifyUrl, code);

  return c.json({ ok: true, author_id: id });
});

// POST /register/work — register a work (after email verified)
registerRoutes.post("/work", async (c) => {
  const body = await c.req.json<{
    author_id: string;
    title: string;
    platform: string;
    platform_url: string;
    note_url: string;
    github_handle?: string;
  }>();

  const author = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE id = ?",
  ).bind(body.author_id).first<{ id: string; status: string }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);
  if (author.status === "pending_email") return c.json({ error: "まずメールアドレスを確認してください。" }, 403);
  if (author.status === "rejected") return c.json({ error: "登録が拒否されました。" }, 403);

  const handle = (body.github_handle ?? "").trim();
  const workSlug = `${handle || body.author_id.slice(0, 8)}-${Date.now()}`;

  const workId = nanoid();
  await c.env.DB.prepare(
    "INSERT INTO works (id, author_id, title, platform, platform_url, slug, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending_manual_review', ?)",
  ).bind(workId, body.author_id, body.title, body.platform, body.platform_url, workSlug, Date.now()).run();

  if (body.note_url) {
    await c.env.DB.prepare("UPDATE authors SET note_url = ?, github_handle = ?, status = 'pending_manual_review' WHERE id = ?")
      .bind(body.note_url, handle || null, body.author_id).run();
  }

  return c.json({ ok: true, work_id: workId, slug: workSlug });
});

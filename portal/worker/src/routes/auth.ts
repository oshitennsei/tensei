import { Hono } from "hono";
import type { Env } from "../index";
import { nanoid } from "../lib/id";
import { sendMagicLink } from "../lib/email";

export const authRoutes = new Hono<{ Bindings: Env }>();

// GET /auth/me — validate session token, return author info
authRoutes.get("/me", async (c) => {
  const bearer = (c.req.header("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!bearer) return c.json({ error: "Unauthorized" }, 401);

  const authorId = await c.env.MAGIC_LINK_KV.get(`sess:${bearer}`);
  if (!authorId) return c.json({ error: "Unauthorized" }, 401);

  const author = await c.env.DB.prepare(
    "SELECT id, display_name, status, verify_code, note_url FROM authors WHERE id = ?",
  ).bind(authorId).first<{ id: string; display_name: string; status: string; verify_code: string; note_url: string | null }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);

  const works = await c.env.DB.prepare(
    "SELECT id, title, platform, platform_url, slug, status FROM works WHERE author_id = ?",
  ).bind(authorId).all<{ id: string; title: string; platform: string; platform_url: string; slug: string; status: string }>();

  return c.json({
    author_id: author.id,
    display_name: author.display_name,
    status: author.status,
    verify_code: author.verify_code,
    note_url: author.note_url,
    works: works.results ?? [],
  });
});

// POST /auth/login — send magic link to existing author (for returning users)
authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email: string }>().catch(() => ({ email: "" }));
  const email = (body.email ?? "").toLowerCase().trim();
  if (!email.includes("@")) return c.json({ error: "有効なメールアドレスを入力してください。" }, 400);

  const author = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE email = ?",
  ).bind(email).first<{ id: string; status: string }>();

  // Always respond OK to prevent email enumeration
  if (!author) return c.json({ ok: true });

  const token = nanoid(32);
  const verifyUrl = `${c.env.WORKER_URL}/verify?token=${token}`;
  await c.env.MAGIC_LINK_KV.put(`ml:${token}`, JSON.stringify({ email, author_id: author.id }), { expirationTtl: 600 });
  await sendMagicLink(c.env.RESEND_API_KEY, c.env.SENDER_EMAIL ?? "onboarding@resend.dev", email, verifyUrl);

  return c.json({ ok: true });
});

import { Hono } from "hono";
import type { Env } from "../index";
import { nanoid } from "../lib/id";

export const verifyRoutes = new Hono<{ Bindings: Env }>();

// GET /verify?token=... — magic link callback
verifyRoutes.get("/", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) return c.json({ error: "トークンがありません。" }, 400);

  const raw = await c.env.MAGIC_LINK_KV.get(`ml:${token}`);
  if (!raw) return c.json({ error: "リンクが無効か期限切れです。" }, 410);

  const { author_id } = JSON.parse(raw) as { email: string; author_id: string };

  const author = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE id = ?",
  ).bind(author_id).first<{ id: string; status: string }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);

  // Only advance status if still pending_email
  if (author.status === "pending_email") {
    await c.env.DB.prepare(
      "UPDATE authors SET status = 'email_verified' WHERE id = ?",
    ).bind(author_id).run();
  }

  await c.env.MAGIC_LINK_KV.delete(`ml:${token}`);

  // Generate session token (30 days)
  const sessionToken = nanoid(40);
  await c.env.MAGIC_LINK_KV.put(`sess:${sessionToken}`, author_id, { expirationTtl: 60 * 60 * 24 * 30 });

  return c.redirect(`${c.env.FRONTEND_URL}/dashboard?token=${sessionToken}`);
});

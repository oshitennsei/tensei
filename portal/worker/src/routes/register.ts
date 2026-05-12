import { Hono } from "hono";
import type { Env } from "../index";
import { nanoid, verifyCode } from "../lib/id";
import { sendMagicLink } from "../lib/email";
import { verifyWorkOwnership, normalizeKakuyomuUrl } from "../lib/platform-verify";

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
    const token = nanoid(32);
    const verifyUrl = `${c.env.WORKER_URL}/verify?token=${token}`;
    await c.env.MAGIC_LINK_KV.put(`ml:${token}`, JSON.stringify({ email, author_id: existing.id }), { expirationTtl: 600 });
    await sendMagicLink(c.env.RESEND_API_KEY, c.env.SENDER_EMAIL ?? "onboarding@resend.dev", email, verifyUrl);
    return c.json({ ok: true, message: "確認メールを再送しました。" });
  }

  const id = nanoid();
  const token = nanoid(32);
  const verifyUrl = `${c.env.WORKER_URL}/verify?token=${token}`;

  await c.env.DB.prepare(
    "INSERT INTO authors (id, email, display_name, status, verify_code, created_at) VALUES (?, ?, ?, 'pending_email', '', ?)",
  ).bind(id, email, display_name, Date.now()).run();

  await c.env.MAGIC_LINK_KV.put(`ml:${token}`, JSON.stringify({ email, author_id: id }), { expirationTtl: 600 });
  await sendMagicLink(c.env.RESEND_API_KEY, c.env.SENDER_EMAIL ?? "onboarding@resend.dev", email, verifyUrl);

  return c.json({ ok: true, author_id: id });
});

// POST /register/request-code — request a work-specific verify code
registerRoutes.post("/request-code", async (c) => {
  const bearer = (c.req.header("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!bearer) return c.json({ error: "Unauthorized" }, 401);

  const authorId = await c.env.MAGIC_LINK_KV.get(`sess:${bearer}`);
  if (!authorId) return c.json({ error: "Unauthorized" }, 401);

  const author = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE id = ?",
  ).bind(authorId).first<{ id: string; status: string }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);
  if (author.status === "pending_email") return c.json({ error: "まずメールアドレスを確認してください。" }, 403);
  if (author.status === "rejected") return c.json({ error: "登録が拒否されました。" }, 403);

  const body = await c.req.json<{ platform_url: string; platform: string }>();
  const platformUrl = normalizeKakuyomuUrl((body.platform_url ?? "").trim());
  if (!platformUrl) return c.json({ error: "platform_urlが必要です。" }, 400);

  const code = verifyCode();
  const kvKey = `wc:${authorId}:${encodeURIComponent(platformUrl)}`;
  await c.env.MAGIC_LINK_KV.put(kvKey, code, { expirationTtl: 60 * 60 * 24 * 7 }); // 7 days

  return c.json({ ok: true, code });
});

// POST /register/work — submit work after posting verify code in author note
registerRoutes.post("/work", async (c) => {
  const body = await c.req.json<{
    author_id?: string;
    title: string;
    platform: string;
    platform_url: string;
    github_handle?: string;
    client_snapshot?: string;
  }>();

  // Prefer Bearer session token; fall back to author_id in body (legacy)
  let resolvedAuthorId = body.author_id ?? "";
  const bearer = (c.req.header("Authorization") ?? "").replace("Bearer ", "").trim();
  if (bearer) {
    const fromSession = await c.env.MAGIC_LINK_KV.get(`sess:${bearer}`);
    if (fromSession) resolvedAuthorId = fromSession;
  }

  const author = await c.env.DB.prepare(
    "SELECT id, status FROM authors WHERE id = ?",
  ).bind(resolvedAuthorId).first<{ id: string; status: string }>();

  if (!author) return c.json({ error: "著者が見つかりません。" }, 404);
  if (author.status === "pending_email") return c.json({ error: "まずメールアドレスを確認してください。" }, 403);
  if (author.status === "rejected") return c.json({ error: "登録が拒否されました。" }, 403);

  const platformUrl = normalizeKakuyomuUrl((body.platform_url ?? "").trim());

  // Look up work-specific code from KV
  const kvKey = `wc:${resolvedAuthorId}:${encodeURIComponent(platformUrl)}`;
  const code = await c.env.MAGIC_LINK_KV.get(kvKey);
  if (!code) {
    return c.json({ error: "認証コードが見つかりません。まず「認証コード申請」を行ってください。" }, 422);
  }

  let snapshot: string | null;

  if (body.client_snapshot !== undefined) {
    // Client-side verification path
    if (!body.client_snapshot.includes(code)) {
      return c.json({ error: "スナップショットに確認コードが含まれていません" }, 422);
    }
    await c.env.MAGIC_LINK_KV.delete(kvKey);
    snapshot = "[ext-verified] " + body.client_snapshot.slice(0, 600);
  } else {
    // Server-side verification path (original logic)
    const result = await verifyWorkOwnership(body.platform, platformUrl, code);
    if (!result.found && !result.fetchFailed) {
      // Code was reachable but not found — reject
      return c.json({ error: `作者ノートにコードが見つかりません：${result.reason}` }, 422);
    }

    // Code verified (or platform unreachable — admin will manually verify)
    await c.env.MAGIC_LINK_KV.delete(kvKey);
    snapshot = result.snapshot ?? (result.fetchFailed ? `[verify-pending: code=${code}; reason=${result.reason}]` : null);
  }

  const handle = (body.github_handle ?? "").trim();
  const workSlug = `${handle || resolvedAuthorId.slice(0, 8)}-${Date.now()}`;
  const workId = nanoid();

  await c.env.DB.prepare(
    "INSERT INTO works (id, author_id, title, platform, platform_url, slug, status, verify_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending_manual_review', ?, ?)",
  ).bind(workId, resolvedAuthorId, body.title, body.platform, platformUrl, workSlug, snapshot, Date.now()).run();

  // Advance author status if still email_verified
  if (author.status === "email_verified") {
    await c.env.DB.prepare(
      "UPDATE authors SET status = 'pending_manual_review', github_handle = ? WHERE id = ?",
    ).bind(handle || null, resolvedAuthorId).run();
  }

  return c.json({ ok: true, work_id: workId, slug: workSlug });
});

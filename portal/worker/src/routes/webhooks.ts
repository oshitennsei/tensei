import { Hono } from "hono";
import type { Env } from "../index";
import { nanoid } from "../lib/id";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

interface PrPayload {
  action: string;
  pull_request: {
    merged: boolean;
    number: number;
    title: string;
    user: { login: string };
  };
  repository: { full_name: string };
}

interface GhFile {
  filename: string;
  status: string;
}

interface GhFileContent {
  content: string; // base64
  sha: string;
}

async function verifySignature(secret: string, body: string, sig: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(body)),
  );
  if (!sig.startsWith("sha256=")) return false;
  const hex = sig.slice(7);
  if (hex.length !== expected.length * 2) return false;
  const provided = new Uint8Array(hex.length / 2);
  for (let i = 0; i < provided.length; i++) {
    provided[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.verify("HMAC", key, provided, enc.encode(body));
}

// POST /webhooks/github — process PR merge events from the tensei-authors repo
webhookRoutes.post("/github", async (c) => {
  const event = c.req.header("X-GitHub-Event");
  const sig   = c.req.header("X-Hub-Signature-256") ?? "";

  // Reject non-PR events early (before reading body)
  if (event !== "pull_request") return c.json({ ok: true });

  const rawBody = await c.req.text();

  // Verify HMAC signature when secret is configured
  if (c.env.GITHUB_WEBHOOK_SECRET) {
    const valid = await verifySignature(c.env.GITHUB_WEBHOOK_SECRET, rawBody, sig);
    if (!valid) return c.json({ error: "Invalid signature" }, 401);
  }

  let payload: PrPayload;
  try {
    payload = JSON.parse(rawBody) as PrPayload;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Only act on merges
  if (payload.action !== "closed" || !payload.pull_request.merged) {
    return c.json({ ok: true });
  }

  // Only process PRs from the designated authors repo
  const expectedRepo = `${c.env.GITHUB_REPO_OWNER}/${c.env.GITHUB_REPO_NAME}`;
  if (payload.repository.full_name !== expectedRepo) {
    return c.json({ ok: true });
  }

  const prNumber = payload.pull_request.number;

  // Fetch list of files changed in this PR
  const filesRes = await fetch(
    `https://api.github.com/repos/${expectedRepo}/pulls/${prNumber}/files`,
    {
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tensei-portal/0.1",
      },
    },
  );
  if (!filesRes.ok) {
    console.error("Failed to fetch PR files:", filesRes.status);
    return c.json({ ok: true }); // best-effort; don't fail the webhook
  }

  const files = await filesRes.json() as GhFile[];

  // Pattern: works/{workSlug}/characters/{charSlug}.json
  const charFileRe = /^works\/([^/]+)\/characters\/([^/]+)\.json$/;

  for (const file of files) {
    const m = file.filename.match(charFileRe);
    if (!m) continue;

    const [, workSlug, charSlug] = m;

    if (file.status === "removed") {
      // Remove character from D1 — look up by work slug + slug
      const work = await c.env.DB.prepare(
        "SELECT id FROM works WHERE slug = ?",
      ).bind(workSlug).first<{ id: string }>();
      if (work) {
        await c.env.DB.prepare(
          "DELETE FROM characters WHERE work_id = ? AND slug = ?",
        ).bind(work.id, charSlug).run();
      }
      continue;
    }

    // Fetch file content from main branch
    const contentRes = await fetch(
      `https://api.github.com/repos/${expectedRepo}/contents/${file.filename}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "tensei-portal/0.1",
        },
      },
    );
    if (!contentRes.ok) continue;

    const contentData = await contentRes.json() as GhFileContent;
    let configJson: Record<string, unknown>;
    try {
      configJson = JSON.parse(atob(contentData.content.replace(/\n/g, "")));
    } catch {
      continue;
    }

    // Look up the work by slug
    const work = await c.env.DB.prepare(
      "SELECT id FROM works WHERE slug = ?",
    ).bind(workSlug).first<{ id: string }>();
    if (!work) continue;

    const name = (typeof configJson.name === "string" ? configJson.name : charSlug);
    const data = JSON.stringify(configJson.data ?? {});
    const lockedFields = JSON.stringify(configJson.locked_fields ?? []);
    const now = Date.now();

    await c.env.DB.prepare(
      `INSERT INTO characters (id, work_id, slug, name, data, locked_fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_id, slug) DO UPDATE SET
         name=excluded.name, data=excluded.data,
         locked_fields=excluded.locked_fields, updated_at=excluded.updated_at`,
    ).bind(nanoid(), work.id, charSlug, name, data, lockedFields, now, now).run();
  }

  return c.json({ ok: true });
});

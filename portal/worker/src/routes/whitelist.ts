import { Hono } from "hono";
import type { Env } from "../index";

const whitelist = new Hono<{ Bindings: Env }>();

// GET /whitelist?work_url=https://kakuyomu.jp/works/123
whitelist.get("/", async (c) => {
  const workUrl = c.req.query("work_url");
  if (!workUrl) return c.json({ error: "work_url required" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT id, title, platform, status FROM works WHERE platform_url = ? LIMIT 1"
  ).bind(workUrl).first<{ id: string; title: string; platform: string; status: string }>();

  if (!row || row.status !== "approved") {
    return c.json({ authorized: false });
  }
  return c.json({ authorized: true, work: { id: row.id, title: row.title, platform: row.platform } });
});

export { whitelist };

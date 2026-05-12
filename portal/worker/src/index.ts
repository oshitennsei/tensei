import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerRoutes } from "./routes/register";
import { verifyRoutes } from "./routes/verify";
import { adminRoutes } from "./routes/admin";
import { statusRoutes } from "./routes/status";
import { whitelist } from "./routes/whitelist";
import { authRoutes } from "./routes/auth";
import { worksContentRoutes } from "./routes/works_content";

export interface Env {
  DB: D1Database;
  MAGIC_LINK_KV: KVNamespace;
  RESEND_API_KEY: string;
  SENDER_EMAIL?: string;
  GITHUB_TOKEN: string;
  ADMIN_SECRET: string;
  FRONTEND_URL: string;
  WORKER_URL: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({
  origin: (origin) => origin ?? "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/", c => c.json({ name: "tensei-portal-api", version: "0.1.0" }));

app.route("/register",  registerRoutes);
app.route("/verify",    verifyRoutes);
app.route("/auth",      authRoutes);
app.route("/status",    statusRoutes);
app.route("/admin",     adminRoutes);
app.route("/whitelist", whitelist);
app.route("/works",     worksContentRoutes);

export default app;

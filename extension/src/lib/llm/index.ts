import { db } from "@/lib/storage";
import type { LlmModel, LlmRole } from "@/lib/storage";

export class LlmError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`LLM ${status}`);
  }
  get userMessage(): string {
    if (this.status === 401 || this.status === 403)
      return "APIキーが正しくありません。設定を確認してください。";
    if (this.status === 429)
      return "レート制限に達しました。しばらく待ってから再試行してください。";
    if (this.status >= 500)
      return "LLMサーバーでエラーが発生しました。しばらく待ってから再試行してください。";
    return `LLMエラー (${this.status})。設定を確認してください。`;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export class LlmClient {
  constructor(private model: LlmModel) {
    // Normalize endpoint URL: strip trailing slash to prevent double-slash in paths
    this.model = { ...model, endpoint_url: model.endpoint_url.replace(/\/+$/, "") };
  }

  static async forRole(role: LlmRole): Promise<LlmClient | null> {
    const model = await getModelForRole(role);
    return model ? new LlmClient(model) : null;
  }

  static async forModel(model_id: string): Promise<LlmClient | null> {
    const model = await db.llm_models.get(model_id);
    return model ? new LlmClient(model) : null;
  }

  get config(): LlmModel { return this.model; }

  async *stream(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.model.endpoint_url}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.model.api_key}`,
      },
      body: JSON.stringify({
        model: this.model.model_name,
        messages,
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(res.status, text);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") { yield { delta: "", done: true }; return; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) yield { delta, done: false };
        } catch {
          // skip malformed SSE line
        }
      }
    }
    yield { delta: "", done: true };
  }

  async complete(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    let result = "";
    for await (const chunk of this.stream(messages, signal)) {
      result += chunk.delta;
    }
    return result;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.model.endpoint_url}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.model.api_key}`,
      },
      body: JSON.stringify({ model: this.model.model_name, input: texts }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(res.status, text);
    }
    const data = await res.json() as { data: Array<{ index: number; embedding: number[] }> };
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(item => new Float32Array(item.embedding));
  }
}

// ── Model registry CRUD ───────────────────────────────────────────────────────

export async function listModels(): Promise<LlmModel[]> {
  return db.llm_models.toArray();
}

export async function saveModel(model: Omit<LlmModel, "id">): Promise<string> {
  const id = crypto.randomUUID();
  await db.llm_models.add({ ...model, id });
  return id;
}

export async function updateModel(id: string, updates: Partial<Omit<LlmModel, "id">>): Promise<void> {
  await db.llm_models.update(id, updates);
}

export async function deleteModel(id: string): Promise<void> {
  await db.llm_models.delete(id);
  // Clear any role assignments pointing to this model
  const rec = await db.llm_role_assignments.get("default");
  if (!rec) return;
  const updated = { ...rec.assignments };
  for (const role of Object.keys(updated) as LlmRole[]) {
    if (updated[role] === id) delete updated[role];
  }
  await db.llm_role_assignments.put({ id: "default", assignments: updated });
}

// ── Role assignment ───────────────────────────────────────────────────────────

export async function getRoleAssignments(): Promise<Partial<Record<LlmRole, string>>> {
  const rec = await db.llm_role_assignments.get("default");
  return rec?.assignments ?? {};
}

export async function setRoleAssignment(role: LlmRole, model_id: string | null): Promise<void> {
  const rec = await db.llm_role_assignments.get("default") ?? { id: "default", assignments: {} };
  const updated = { ...rec.assignments };
  if (model_id) updated[role] = model_id;
  else delete updated[role];
  await db.llm_role_assignments.put({ id: "default", assignments: updated });
}

export async function getModelForRole(role: LlmRole): Promise<LlmModel | null> {
  const assignments = await getRoleAssignments();
  const model_id = assignments[role];
  if (!model_id) return null;
  return (await db.llm_models.get(model_id)) ?? null;
}

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error: string }).error ?? res.statusText);
  return data as T;
}

async function get<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
  register: (email: string, display_name: string) =>
    post<{ ok: boolean; author_id?: string }>("/register", { email, display_name }),

  registerWork: (author_id: string, title: string, platform: string, platform_url: string, note_url: string, github_handle: string) =>
    post<{ ok: boolean; work_id: string; slug: string }>("/register/work", { author_id, title, platform, platform_url, note_url, github_handle }),

  status: (author_id: string) =>
    get<{
      author_id: string;
      display_name: string;
      status: string;
      verify_code: string;
      note_url: string | null;
      works: Array<{ id: string; title: string; platform: string; slug: string; status: string }>;
    }>(`/status/${author_id}`),

  submitCharacter: (author_id: string, work_slug: string, character_slug: string, config: unknown) =>
    post<{ ok: boolean; pr_url: string }>(`/status/${author_id}/character`, { work_slug, character_slug, config }),

  admin: {
    queue: (secret: string) => get<{ authors: unknown[] }>("/admin/queue", secret),
    all: (secret: string) => get<{ authors: unknown[] }>("/admin/all", secret),
    approve: (secret: string, author_id: string, github_handle: string, admin_note?: string) =>
      post("/admin/approve/" + author_id, { github_handle, admin_note }, secret),
    reject: (secret: string, author_id: string, admin_note?: string) =>
      post("/admin/reject/" + author_id, { admin_note }, secret),
  },
};

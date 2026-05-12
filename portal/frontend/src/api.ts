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

async function put<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
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

async function del<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error: string }).error ?? res.statusText);
  return data as T;
}

// ── Phase 6 types ─────────────────────────────────────────────────────────────

export type LockedField = "persona" | "speech_style" | "will_not_do" | "forbidden_topics";

export interface PortalCharacter {
  id: string;
  work_id: string;
  slug: string;
  name: string;
  data: {
    persona?: string;
    speech_style?: string;
    will_do?: string[];
    will_not_do?: string[];
    forbidden_topics?: string[];
    voice_samples?: Array<{ context: string; line: string; chapter?: number }>;
    dialogue_examples?: Array<{ context: string; user_message_pattern: string; ideal_response: string; notes?: string }>;
    state_snapshots?: unknown[];
  };
  locked_fields: LockedField[];
  updated_at: number;
}

export interface PortalChapterSummary {
  id: string;
  work_id: string;
  chapter_number: number;
  summary: string;
  locked: boolean;
  updated_at: number;
}

export interface PutCharacterBody {
  name: string;
  data: PortalCharacter["data"];
  locked_fields: LockedField[];
}

export interface PutSummaryBody {
  summary: string;
  locked?: boolean;
}

export interface AuthorData {
  author_id: string;
  display_name: string;
  status: string;
  verify_code: string;
  note_url: string | null;
  works: Array<{ id: string; title: string; platform: string; platform_url: string; slug: string; status: string }>;
}

export const api = {
  // Auth
  me: (token: string) => get<AuthorData>("/auth/me", token),
  login: (email: string) => post<{ ok: boolean }>("/auth/login", { email }),

  // Registration
  register: (email: string, display_name: string) =>
    post<{ ok: boolean; author_id?: string }>("/register", { email, display_name }),

  requestCode: (token: string, platform_url: string, platform: string) =>
    post<{ ok: boolean; code: string }>("/register/request-code", { platform_url, platform }, token),

  registerWork: (token: string, title: string, platform: string, platform_url: string, github_handle?: string) =>
    post<{ ok: boolean; work_id: string; slug: string }>(
      "/register/work",
      { title, platform, platform_url, github_handle },
      token,
    ),

  // Works content (Phase 6)
  getCharacters: (work_id: string) =>
    get<{ characters: PortalCharacter[] }>(`/works/${work_id}/characters`),
  putCharacter: (token: string, work_id: string, slug: string, body: PutCharacterBody) =>
    put<{ ok: boolean; character: PortalCharacter }>(`/works/${work_id}/characters/${slug}`, body, token),
  deleteCharacter: (token: string, work_id: string, slug: string) =>
    del<{ ok: boolean }>(`/works/${work_id}/characters/${slug}`, token),
  getSummaries: (work_id: string) =>
    get<{ summaries: PortalChapterSummary[] }>(`/works/${work_id}/summaries`),
  putSummary: (token: string, work_id: string, chapter_number: number, body: PutSummaryBody) =>
    put<{ ok: boolean }>(`/works/${work_id}/summaries/${chapter_number}`, body, token),
  deleteSummary: (token: string, work_id: string, chapter_number: number) =>
    del<{ ok: boolean }>(`/works/${work_id}/summaries/${chapter_number}`, token),

  admin: {
    queue: (secret: string) => get<{ authors: unknown[] }>("/admin/queue", secret),
    all: (secret: string) => get<{ authors: unknown[] }>("/admin/all", secret),
    approve: (secret: string, author_id: string, github_handle: string, admin_note?: string) =>
      post("/admin/approve/" + author_id, { github_handle, admin_note }, secret),
    reject: (secret: string, author_id: string, admin_note?: string) =>
      post("/admin/reject/" + author_id, { admin_note }, secret),
    approveWork: (secret: string, platform_url: string) =>
      post("/admin/approve-work", { platform_url }, secret),
    pendingWorks: (secret: string) => get<{ works: unknown[] }>("/admin/pending-works", secret),
    allWorks: (secret: string) => get<{ works: unknown[] }>("/admin/all-works", secret),
    checkNote: (secret: string, author_id: string) =>
      get<{ verified: boolean; reason: string }>(`/admin/check-note/${author_id}`, secret),
    suspendWork: (secret: string, work_id: string) =>
      post("/admin/suspend-work", { work_id }, secret),
    restoreWork: (secret: string, work_id: string) =>
      post("/admin/restore-work", { work_id }, secret),
    deleteWork: (secret: string, work_id: string) =>
      post("/admin/delete-work", { work_id }, secret),
  },
};

const PORTAL_BASE = "https://tensei-portal-api.tensei-portal.workers.dev";

export interface PortalAuthor {
  author_id: string;
  display_name: string;
  status: string;
  works: Array<{ id: string; title: string; platform: string; platform_url: string; status: string }>;
}

export const PORTAL_SESSION_KEY = "portal_session_token";

export async function getPortalSession(): Promise<string | null> {
  return new Promise(resolve => {
    chrome.storage.local.get(PORTAL_SESSION_KEY, r => resolve(r[PORTAL_SESSION_KEY] ?? null));
  });
}

export async function clearPortalSession(): Promise<void> {
  return new Promise(resolve => chrome.storage.local.remove(PORTAL_SESSION_KEY, resolve));
}

export async function portalLogin(email: string): Promise<void> {
  await fetch(`${PORTAL_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function portalMe(token: string): Promise<PortalAuthor | null> {
  try {
    const res = await fetch(`${PORTAL_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json() as Promise<PortalAuthor>;
  } catch { return null; }
}

export async function portalRequestCode(token: string, platform_url: string, platform: string): Promise<string> {
  const res = await fetch(`${PORTAL_BASE}/register/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform_url, platform }),
  });
  const data = await res.json() as { ok?: boolean; code?: string; error?: string };
  if (!res.ok || !data.code) throw new Error(data.error ?? "コード取得失敗");
  return data.code;
}

export async function portalRegisterWork(token: string, params: {
  title: string;
  platform: string;
  platform_url: string;
  github_handle?: string;
  client_snapshot?: string;
}): Promise<{ work_id: string; slug: string }> {
  const res = await fetch(`${PORTAL_BASE}/register/work`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  const data = await res.json() as { ok?: boolean; work_id?: string; slug?: string; error?: string };
  if (!res.ok || !data.work_id) throw new Error(data.error ?? "作品登録失敗");
  return { work_id: data.work_id!, slug: data.slug! };
}

// ── Phase 6: character + summary sync ────────────────────────────────────────

export type LockedField = "persona" | "speech_style" | "will_not_do" | "forbidden_topics";

export interface PortalCharacterResult {
  id: string;
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

export interface PortalSummaryResult {
  chapter_number: number;
  summary: string;
  locked: boolean;
  updated_at: number;
}

export async function portalGetCharacters(workId: string): Promise<PortalCharacterResult[]> {
  try {
    const res = await fetch(`${PORTAL_BASE}/works/${workId}/characters`);
    if (!res.ok) return [];
    const data = await res.json() as { characters?: PortalCharacterResult[] };
    return data.characters ?? [];
  } catch { return []; }
}

export async function portalGetSummaries(workId: string): Promise<PortalSummaryResult[]> {
  try {
    const res = await fetch(`${PORTAL_BASE}/works/${workId}/summaries`);
    if (!res.ok) return [];
    const data = await res.json() as { summaries?: PortalSummaryResult[] };
    return data.summaries ?? [];
  } catch { return []; }
}

export async function portalPutCharacters(
  token: string,
  workId: string,
  characters: Array<{
    slug: string;
    name: string;
    data: PortalCharacterResult["data"];
    locked_fields: LockedField[];
  }>,
): Promise<void> {
  for (const char of characters) {
    await fetch(`${PORTAL_BASE}/works/${workId}/characters/${char.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: char.name, data: char.data, locked_fields: char.locked_fields }),
    });
  }
}

export async function portalPutSummary(
  token: string,
  workId: string,
  chapterNum: number,
  summary: string,
  locked = false,
): Promise<void> {
  await fetch(`${PORTAL_BASE}/works/${workId}/summaries/${chapterNum}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ summary, locked }),
  });
}

export async function verifyCodeOnKakuyomu(workId: string, code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://kakuyomu.jp/works/${workId}`);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]+>([\s\S]*?)<\/script>/);
    if (!match) return null;
    const nextData = JSON.parse(match[1]) as { props?: { pageProps?: { __APOLLO_STATE__?: Record<string, { introduction?: string; catchphrase?: string }> } } };
    const apollo = nextData.props?.pageProps?.__APOLLO_STATE__ ?? {};
    const work = apollo[`Work:${workId}`];
    if (!work) return null;
    const intro = work.introduction ?? "";
    const catchphrase = work.catchphrase ?? "";
    if (intro.includes(code)) return intro.slice(0, 600);
    if (catchphrase.includes(code)) return catchphrase.slice(0, 200);
    return null;
  } catch { return null; }
}

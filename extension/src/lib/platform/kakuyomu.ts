export interface KakuyomuEpisode {
  episode_id: string;
  title: string;
  order: number;
}

export interface KakuyomuPageInfo {
  work_id: string;
  work_url: string;
  title: string;
  author: string;
  episodes: KakuyomuEpisode[];
}

export type AuthorizationResult =
  | { authorized: true; work_title: string }
  | { authorized: false; reason: "not_registered" | "pending" | "network_error" };

const PORTAL_BASE = "https://tensei-portal-api.tensei-portal.workers.dev";

export async function checkKakuyomuAuthorization(workUrl: string): Promise<AuthorizationResult> {
  try {
    const res = await fetch(`${PORTAL_BASE}/whitelist?work_url=${encodeURIComponent(workUrl)}`);
    if (!res.ok) return { authorized: false, reason: "network_error" };
    const data = await res.json() as { authorized: boolean; work?: { title: string } };
    if (data.authorized && data.work) {
      return { authorized: true, work_title: data.work.title };
    }
    return { authorized: false, reason: "not_registered" };
  } catch {
    return { authorized: false, reason: "network_error" };
  }
}

export function parseKakuyomuWorkUrl(url: string): { work_id: string; canonical: string } | null {
  const m = url.match(/kakuyomu\.jp\/works\/(\d+)/);
  if (!m) return null;
  return { work_id: m[1], canonical: `https://kakuyomu.jp/works/${m[1]}` };
}

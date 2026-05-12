export interface SyosetsuChapter {
  chapter_num: number;  // 1-based, matches URL path component
  title: string;
  order: number;
}

export interface SyosetsuPageInfo {
  ncode: string;
  work_url: string;
  title: string;
  author: string;
  chapters: SyosetsuChapter[];
}

export type AuthorizationResult =
  | { authorized: true; work_title: string }
  | { authorized: false; reason: "not_registered" | "pending" | "network_error" };

const PORTAL_BASE = "https://tensei-portal-api.tensei-portal.workers.dev";

export async function checkSyosetsuAuthorization(workUrl: string): Promise<AuthorizationResult> {
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

export function parseSyosetsuWorkUrl(url: string): { ncode: string; canonical: string } | null {
  const m = url.match(/(?:ncode|novel18)\.syosetu\.com\/(n[a-z0-9]+)/);
  if (!m) return null;
  return { ncode: m[1], canonical: `https://ncode.syosetu.com/${m[1]}/` };
}

export function isSyosetsuChapterPage(url: string): boolean {
  return /(?:ncode|novel18)\.syosetu\.com\/n[a-z0-9]+\/\d+/.test(url);
}

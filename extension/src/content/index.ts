import type { KakuyomuPageInfo, KakuyomuEpisode } from "@/lib/platform/kakuyomu";
import type { SyosetsuPageInfo, SyosetsuChapter } from "@/lib/platform/syosetu";

// Inject extension ID into portal/PWA pages so the guide can detect the extension
(function injectExtId() {
  const host = location.hostname;
  if (host !== "tensei-portal.pages.dev" && host !== "tensei.alexlee.ccwu.cc") return;
  document.documentElement.setAttribute("data-tensei-ext-id", chrome.runtime.id);
})();

// Portal magic-link callback: forward session token to extension
// (more reliable than tabs.onUpdated because content scripts don't depend on the service worker)
(function notifyPortalAuth() {
  if (location.hostname !== "tensei-portal.pages.dev") return;
  if (location.pathname !== "/dashboard") return;
  const token = new URLSearchParams(location.search).get("token");
  if (!token) return;
  chrome.runtime.sendMessage({ type: "PORTAL_AUTH_SUCCESS", token }).catch(() => {});
})();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "KK_GET_PAGE_INFO") {
    getKkPageInfo().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === "KK_FETCH_EPISODE") {
    fetchKkEpisodeText(msg.episode_id as string, msg.work_id as string)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === "SS_GET_PAGE_INFO") {
    getSsPageInfo().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (msg.type === "SS_FETCH_CHAPTER") {
    fetchSsChapter(msg.ncode as string, msg.chapter_num as number)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
});

async function getKkPageInfo(): Promise<KakuyomuPageInfo | null> {
  const workMatch = location.href.match(/kakuyomu\.jp\/works\/(\d+)(?:\/|$)/);
  if (!workMatch) return null;
  if (location.href.includes("/episodes/")) return null;

  const work_id = workMatch[1];
  const title = document.querySelector("h1")?.textContent?.trim() ?? "";
  const authorEl = document.querySelector('[class*="author"], [class*="creator"]');
  const author = authorEl?.textContent?.trim() ?? "";

  const episodeLinks = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
  const seen = new Set<string>();
  const episodes: KakuyomuEpisode[] = [];
  let order = 1;
  for (const a of episodeLinks) {
    const href = (a as HTMLAnchorElement).href;
    const m = href.match(/\/episodes\/(\d+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    episodes.push({ episode_id: m[1], title: a.textContent?.trim() ?? "", order: order++ });
  }

  return { work_id, work_url: `https://kakuyomu.jp/works/${work_id}`, title, author, episodes };
}

async function fetchKkEpisodeText(episode_id: string, work_id: string): Promise<string | null> {
  const url = `https://kakuyomu.jp/works/${work_id}/episodes/${episode_id}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.querySelector(".widget-episodeBody, [class*='episodeBody']");
  if (!body) return null;
  return (body as HTMLElement).innerText ?? body.textContent ?? null;
}

async function getSsPageInfo(): Promise<SyosetsuPageInfo | null> {
  const m = location.href.match(/(?:ncode|novel18)\.syosetu\.com\/(n[a-z0-9]+)/);
  if (!m) return null;
  // Don't parse on chapter pages (URL has a digit segment after ncode)
  if (/(?:ncode|novel18)\.syosetu\.com\/n[a-z0-9]+\/\d+/.test(location.href)) return null;

  const ncode = m[1];
  // New Syosetu design (p-* classes); fall back to old class names
  const title = document.querySelector(".p-novel__title, .novel_title")?.textContent?.trim() ?? "";
  const authorEl = document.querySelector(".p-novel__author, .novel_author");
  const author = authorEl?.textContent?.replace(/^作者[：:]\s*/, "").trim() ?? "";

  // New design: a.p-eplist__subtitle; old design: .novel_sublist2 .subtitle a
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a.p-eplist__subtitle, .novel_sublist2 .subtitle a")
  );
  const seen = new Set<number>();
  const chapters: SyosetsuChapter[] = [];
  for (const a of links) {
    const cm = a.href.match(new RegExp(`/${ncode}/(\\d+)/?`));
    if (!cm) continue;
    const num = parseInt(cm[1]);
    if (seen.has(num)) continue;
    seen.add(num);
    chapters.push({ chapter_num: num, title: a.textContent?.trim() ?? `第${num}話`, order: 0 });
  }
  chapters.sort((a, b) => a.chapter_num - b.chapter_num);
  chapters.forEach((c, i) => { c.order = i + 1; });

  return { ncode, work_url: `https://ncode.syosetu.com/${ncode}/`, title, author, chapters };
}

async function fetchSsChapter(ncode: string, chapter_num: number): Promise<string | null> {
  const url = `https://ncode.syosetu.com/${ncode}/${chapter_num}/`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  // New Syosetu design uses .js-novel-text; old design uses #novel_honbun
  const body = doc.querySelector(".js-novel-text, #novel_honbun, .novel_honbun");
  if (!body) return null;
  return (body as HTMLElement).innerText ?? body.textContent ?? null;
}

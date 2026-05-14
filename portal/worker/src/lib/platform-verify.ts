export interface VerifyResult {
  found: boolean;
  snapshot?: string;
  reason?: string;
  fetchFailed?: boolean; // true when the platform was unreachable (HTTP error); code presence unknown
}

const BOT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_HEADERS = {
  "User-Agent": BOT_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
};

function extractSnippet(html: string, code: string): string {
  const idx = html.indexOf(code);
  const raw = html.slice(Math.max(0, idx - 300), idx + code.length + 300);
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function verifyOnSyosetu(ncode: string, code: string): Promise<VerifyResult> {
  try {
    // Step 1: fetch work TOC page to get synopsis and author userid
    const tocUrl = `https://ncode.syosetu.com/${ncode}/`;
    const tocRes = await fetch(tocUrl, { headers: FETCH_HEADERS });
    if (!tocRes.ok) return { found: false, fetchFailed: true, reason: `作品ページ取得失敗 (HTTP ${tocRes.status})` };
    const tocHtml = await tocRes.text();

    // Check synopsis (novel_ex) first
    const synopsisMatch = tocHtml.match(/id="novel_ex"[^>]*>([\s\S]*?)<\/div>/);
    const synopsis = synopsisMatch ? synopsisMatch[1] : "";
    if (synopsis.includes(code)) {
      return { found: true, snapshot: extractSnippet(synopsis, code) };
    }

    // Step 2: find author userid from mypage link, then check 活動報告
    const userIdMatch = tocHtml.match(/mypage\.syosetu\.com\/(\d+)\//);
    if (!userIdMatch) return { found: false, reason: "著者のユーザーIDを取得できません" };
    const userId = userIdMatch[1];

    const blogUrl = `https://mypage.syosetu.com/mypageblog/list/userid/${userId}/`;
    const blogRes = await fetch(blogUrl, { headers: FETCH_HEADERS });
    if (!blogRes.ok) return { found: false, fetchFailed: true, reason: `活動報告ページ取得失敗 (HTTP ${blogRes.status})` };
    const blogHtml = await blogRes.text();

    if (blogHtml.includes(code)) {
      return { found: true, snapshot: extractSnippet(blogHtml, code) };
    }

    return { found: false, reason: "コードが活動報告・作品紹介に見つかりません" };
  } catch (e) {
    return { found: false, fetchFailed: true, reason: `取得エラー: ${String(e)}` };
  }
}

export async function verifyOnKakuyomu(workId: string, code: string): Promise<VerifyResult> {
  // Kakuyomu is CSR (Next.js + Apollo). We read the work's introduction and catchphrase
  // from __NEXT_DATA__ on the work page — both are SSR-embedded and author-controlled.
  const workUrl = `https://kakuyomu.jp/works/${workId}`;
  try {
    const res = await fetch(workUrl, { headers: FETCH_HEADERS });
    if (!res.ok) return { found: false, fetchFailed: true, reason: `作品ページ取得失敗 (HTTP ${res.status})` };
    const html = await res.text();

    // Extract __NEXT_DATA__
    const match = html.match(/<script id="__NEXT_DATA__"[^>]+>(\{.*?\})<\/script>/s);
    if (!match) return { found: false, reason: "__NEXT_DATA__が見つかりません" };

    const nextData = JSON.parse(match[1]) as {
      props: { pageProps: { __APOLLO_STATE__?: Record<string, { introduction?: string; catchphrase?: string }> } };
    };
    const apollo = nextData.props?.pageProps?.__APOLLO_STATE__ ?? {};
    const work = apollo[`Work:${workId}`];

    if (!work) return { found: false, reason: "作品データが見つかりません" };

    const introduction = work.introduction ?? "";
    const catchphrase = work.catchphrase ?? "";

    if (introduction.includes(code)) {
      return { found: true, snapshot: extractSnippet(introduction, code) };
    }
    if (catchphrase.includes(code)) {
      return { found: true, snapshot: extractSnippet(catchphrase, code) };
    }

    return { found: false, reason: "作品紹介・キャッチコピーにコードが見つかりません" };
  } catch (e) {
    return { found: false, reason: `取得エラー: ${String(e)}` };
  }
}

export function normalizeKakuyomuUrl(url: string): string {
  // Author-side URLs use /my/works/{id}; normalize to the public reader URL
  return url.replace(/kakuyomu\.jp\/my\/works\//, "kakuyomu.jp/works/");
}

export async function verifyWorkOwnership(
  platform: string,
  platformUrl: string,
  code: string,
): Promise<VerifyResult> {
  if (platform === "syosetu" || platformUrl.includes("syosetu.com")) {
    const m = platformUrl.match(/(?:ncode|novel18)\.syosetu\.com\/(n[a-z0-9]+)/i);
    if (!m) return { found: false, reason: "SyosetuのURLからNコードを取得できません" };
    return verifyOnSyosetu(m[1], code);
  }

  if (platform === "kakuyomu" || platformUrl.includes("kakuyomu.jp")) {
    const normalized = normalizeKakuyomuUrl(platformUrl);
    const m = normalized.match(/kakuyomu\.jp\/works\/(\d+)/);
    if (!m) return { found: false, reason: "KakuyomuのURLから作品IDを取得できません" };
    return verifyOnKakuyomu(m[1], code);
  }

  return { found: false, reason: `未対応のプラットフォーム: ${platform}` };
}

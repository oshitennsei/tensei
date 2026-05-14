import { useState, useEffect, useCallback } from "react";
import {
  getPortalSession, clearPortalSession, portalLogin, portalMe, portalRequestCode,
  portalRegisterWork, verifyCodeOnKakuyomu, verifyCodeOnSyosetu, type PortalAuthor,
} from "@/lib/portal";
import { parseSyosetsuWorkUrl, isSyosetsuChapterPage } from "@/lib/platform/syosetu";
import { db } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

type Step = "idle" | "login-sent" | "requesting" | "code" | "verifying" | "done" | "error";

type WorkInfo =
  | { platform: "kakuyomu"; workId: string; canonical: string }
  | { platform: "syosetu"; ncode: string; canonical: string };

function parseKakuyomuWorkId(url: string): { workId: string; canonical: string } | null {
  const m = url.match(/kakuyomu\.jp\/(?:my\/)?works\/(\d+)/);
  if (!m) return null;
  return { workId: m[1], canonical: `https://kakuyomu.jp/works/${m[1]}` };
}

function detectWorkInfo(url: string): WorkInfo | null {
  const kakuyomu = parseKakuyomuWorkId(url);
  if (kakuyomu) return { platform: "kakuyomu", ...kakuyomu };
  if (isSyosetsuChapterPage(url)) return null;
  const syosetu = parseSyosetsuWorkUrl(url);
  if (syosetu) return { platform: "syosetu", ...syosetu };
  return null;
}

function cleanTabTitle(raw: string): string {
  return raw
    .replace(/\s*[-–—｜|]\s*(カクヨム|小説家になろう|Kakuyomu|Syosetu).*$/i, "")
    .trim();
}

export function WorkRegisterScreen({ onBack, initialWorkUrl }: { onBack: () => void; initialWorkUrl?: string }) {
  const str = useStrings();
  const [session, setSession] = useState<string | null>(null);
  const [author, setAuthor] = useState<PortalAuthor | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [tabUrl, setTabUrl] = useState<string>(initialWorkUrl ?? "");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const workInfo = detectWorkInfo(tabUrl);

  const loadSession = useCallback(async () => {
    try {
      const token = await getPortalSession();
      setSession(token);
      if (token) {
        const me = await portalMe(token);
        if (!me) { await clearPortalSession(); setSession(null); }
        else setAuthor(me);
      }
    } finally {
      setSessionChecking(false);
    }
  }, []);

  useEffect(() => {
    loadSession().catch(() => {});
    if (!initialWorkUrl) {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        setTabUrl(tabs[0]?.url ?? "");
      });
    }
    const handler = (msg: { type: string; token?: string }) => {
      if (msg.type === "PORTAL_AUTH_SUCCESS" && msg.token) {
        chrome.storage.local.set({ portal_session_token: msg.token });
        setSession(msg.token);
        portalMe(msg.token).then(me => { if (me) setAuthor(me); }).catch(() => {});
        setStep("idle");
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [loadSession, initialWorkUrl]);

  // Fetch the work's TOC page to extract the title — works regardless of which
  // page the user is currently on (TOC or chapter page).
  useEffect(() => {
    if (!initialWorkUrl) return;
    fetch(initialWorkUrl)
      .then(r => r.text())
      .then(html => {
        const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (!m) return;
        const cleaned = cleanTabTitle(m[1].trim());
        if (cleaned) setWorkTitle(cleaned);
      })
      .catch(() => {});
  }, [initialWorkUrl]);

  const handleLogin = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await portalLogin(email.trim());
      setStep("login-sent");
    } catch { setMsg(str.wr_send_error); }
    finally { setLoading(false); }
  };

  const handleRequestCode = async () => {
    if (!session || !workInfo) return;
    setLoading(true); setMsg("");
    try {
      const code = await portalRequestCode(session, workInfo.canonical, workInfo.platform);
      setVerifyCode(code);
      setStep("code");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!session || !workInfo || !verifyCode) return;
    setLoading(true); setStep("verifying"); setMsg("");
    try {
      let snapshot: string | null;
      if (workInfo.platform === "kakuyomu") {
        snapshot = await verifyCodeOnKakuyomu(workInfo.workId, verifyCode);
      } else {
        snapshot = await verifyCodeOnSyosetu(workInfo.ncode, verifyCode);
      }
      if (!snapshot) {
        setStep("code");
        setMsg(workInfo.platform === "kakuyomu" ? str.wr_not_found_kakuyomu : str.wr_not_found_syosetu);
        return;
      }
      const registered = await portalRegisterWork(session, {
        title: workTitle || str.wr_untitled,
        platform: workInfo.platform,
        platform_url: workInfo.canonical,
        client_snapshot: snapshot,
      });
      const localWork = await db.works.where("platform_url").equals(workInfo.canonical).first();
      if (localWork && registered.work_id) {
        await db.works.update(localWork.id, { portal_work_id: registered.work_id });
      }
      setStep("done");
    } catch (e) { setStep("code"); setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const handleLogout = async () => {
    await clearPortalSession();
    setSession(null); setAuthor(null); setStep("idle");
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (sessionChecking) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">←</button>
          <h2 className="font-semibold text-sm">{str.author_verify_title}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400">...</p>
        </div>
      </div>
    );
  }

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">←</button>
          <h2 className="font-semibold text-sm">{str.author_verify_title}</h2>
        </div>
        <div className="flex-1 px-4 py-6 space-y-4">
          {step === "login-sent" ? (
            <div className="space-y-3">
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">{str.wr_sent_title}</p>
              <p className="text-xs text-gray-400">{str.wr_sent_hint}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-indigo-50 rounded-lg px-4 py-3 space-y-1">
                <p className="text-sm font-medium text-indigo-800">{str.wr_for_authors}</p>
                <p className="text-xs text-indigo-700 leading-relaxed">{str.author_verify_desc}</p>
              </div>
              <div className="space-y-3">
                <p className="text-xs text-gray-500">{str.wr_email_hint}</p>
                <input
                  type="email"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                />
                {msg && <p className="text-xs text-red-500">{msg}</p>}
                <button
                  onClick={handleLogin}
                  disabled={loading || !email.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {loading ? str.wr_sending : str.wr_send_magic_link}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Logged in ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">←</button>
        <h2 className="font-semibold text-sm flex-1">{str.author_verify_title}</h2>
        {author && (
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-400">{str.wr_logout}</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {!workInfo ? (
          // ── No work detected ─────────────────────────────────────────────
          <>
            {author && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-xs text-gray-600">{author.display_name}</span>
                <span className="text-xs text-gray-400 ml-auto">{author.status}</span>
              </div>
            )}
            {author && author.works.length > 0 && (
              <div className="border border-gray-100 rounded-lg p-3 space-y-1.5">
                <p className="text-xs font-medium text-gray-500 mb-2">{str.wr_registered_works}</p>
                {author.works.map(w => (
                  <div key={w.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-700 truncate">{w.title}</span>
                    <span className={`text-xs shrink-0 ${w.status === "approved" ? "text-green-500" : "text-orange-400"}`}>
                      {w.status === "approved" ? str.wr_status_approved : str.wr_status_pending}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-center py-6 space-y-1">
              <p className="text-sm text-gray-500">{str.wr_open_work_page}</p>
              <p className="text-xs text-gray-400">{str.wr_open_work_page_hint}</p>
              <p className="text-xs text-gray-400">kakuyomu.jp/works/... · ncode.syosetu.com/n...</p>
            </div>
          </>

        ) : step === "done" ? (
          // ── Done ────────────────────────────────────────────────────────
          <div className="space-y-3 text-center py-6">
            <div className="text-3xl">✓</div>
            <p className="text-sm font-medium text-green-700">{str.wr_done_title}</p>
            <p className="text-xs text-gray-500">{str.wr_done_desc}</p>
            <button
              onClick={() => { setStep("idle"); setVerifyCode(""); setMsg(""); }}
              className="text-xs text-indigo-500 hover:underline"
            >
              {str.wr_register_another}
            </button>
          </div>

        ) : (
          // ── Registration form ────────────────────────────────────────────
          <div className="space-y-4">
            {author && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="text-xs text-gray-600">{author.display_name}</span>
                <span className="text-xs text-gray-400 ml-auto">{author.status}</span>
              </div>
            )}
            <div className="bg-indigo-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">{str.wr_detected_work}</p>
              <p className="text-xs font-mono text-indigo-700 truncate">{workInfo.canonical}</p>
            </div>

            {step === "idle" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{str.wr_title_label}</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder={str.wr_title_placeholder}
                    value={workTitle}
                    onChange={e => setWorkTitle(e.target.value)}
                  />
                </div>
                {msg && <p className="text-xs text-red-500">{msg}</p>}
                <button
                  onClick={handleRequestCode}
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {loading ? str.wr_requesting : str.wr_request_code}
                </button>
              </div>
            )}

            {(step === "code" || step === "verifying") && (
              <div className="space-y-3">
                <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-gray-500">
                    {workInfo.platform === "syosetu" ? str.wr_code_instruction_syosetu : str.wr_code_instruction_kakuyomu}
                  </p>
                  <code className="block text-indigo-600 font-mono text-sm bg-gray-50 rounded px-3 py-2 select-all">{verifyCode}</code>
                  <p className="text-xs text-gray-400">
                    {workInfo.platform === "syosetu" ? str.wr_code_how_syosetu : str.wr_code_how_kakuyomu}
                  </p>
                </div>
                {msg && <p className="text-xs text-red-500">{msg}</p>}
                <button
                  onClick={handleVerify}
                  disabled={loading || step === "verifying"}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {step === "verifying" ? str.wr_verifying : str.wr_verify_btn}
                </button>
                <button
                  onClick={() => { setStep("idle"); setVerifyCode(""); setMsg(""); }}
                  className="w-full text-xs text-gray-400 hover:text-gray-600"
                >
                  {str.wr_retry}
                </button>
              </div>
            )}

            {author && author.works.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">{str.wr_registered_works}</p>
                {author.works.map(w => (
                  <div key={w.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="text-xs text-gray-600 truncate">{w.title}</span>
                    <span className={`text-xs shrink-0 ${w.status === "approved" ? "text-green-500" : "text-orange-400"}`}>
                      {w.status === "approved" ? str.wr_status_approved : str.wr_status_pending}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

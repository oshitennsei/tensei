import { useState, useEffect, useCallback } from "react";
import {
  getPortalSession, clearPortalSession, portalLogin, portalMe, portalRequestCode,
  portalRegisterWork, verifyCodeOnKakuyomu, type PortalAuthor,
} from "@/lib/portal";
import { useStrings } from "@/lib/i18n";

type Step = "idle" | "login-sent" | "requesting" | "code" | "verifying" | "done" | "error";

function parseKakuyomuWorkId(url: string): { workId: string; canonical: string } | null {
  const m = url.match(/kakuyomu\.jp\/(?:my\/)?works\/(\d+)/);
  if (!m) return null;
  return { workId: m[1], canonical: `https://kakuyomu.jp/works/${m[1]}` };
}

export function WorkRegisterScreen({ onBack }: { onBack: () => void }) {
  const str = useStrings();
  const [session, setSession] = useState<string | null>(null);
  const [author, setAuthor] = useState<PortalAuthor | null>(null);
  const [tabUrl, setTabUrl] = useState<string>("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [verifyCode, setVerifyCode] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const workInfo = parseKakuyomuWorkId(tabUrl);

  const loadSession = useCallback(async () => {
    const token = await getPortalSession();
    setSession(token);
    if (token) {
      const me = await portalMe(token);
      if (!me) { await clearPortalSession(); setSession(null); }
      else setAuthor(me);
    }
  }, []);

  useEffect(() => {
    loadSession().catch(() => {});
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      setTabUrl(tabs[0]?.url ?? "");
    });
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
  }, [loadSession]);

  const handleLogin = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await portalLogin(email.trim());
      setStep("login-sent");
    } catch { setMsg("送信失敗。もう一度お試しください。"); }
    finally { setLoading(false); }
  };

  const handleRequestCode = async () => {
    if (!session || !workInfo) return;
    setLoading(true); setMsg("");
    try {
      const code = await portalRequestCode(session, workInfo.canonical, "kakuyomu");
      setVerifyCode(code);
      setStep("code");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!session || !workInfo || !verifyCode) return;
    setLoading(true); setStep("verifying"); setMsg("");
    try {
      const snapshot = await verifyCodeOnKakuyomu(workInfo.workId, verifyCode);
      if (!snapshot) {
        setStep("code");
        setMsg("作品紹介にコードが見つかりません。追記して保存してからもう一度。");
        return;
      }
      await portalRegisterWork(session, {
        title: workTitle || "（タイトル未設定）",
        platform: "kakuyomu",
        platform_url: workInfo.canonical,
        client_snapshot: snapshot,
      });
      setStep("done");
    } catch (e) { setStep("code"); setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const handleLogout = async () => {
    await clearPortalSession();
    setSession(null); setAuthor(null); setStep("idle");
  };

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
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-4 py-3">
                メールを送信しました。リンクをクリックすると自動でログインされます。
              </p>
              <p className="text-xs text-gray-400">ブラウザでメールを開き、マジックリンクをクリックしてください。</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Tenseiポータルのメールアドレスを入力してください。</p>
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
                {loading ? "送信中..." : "マジックリンクを送信"}
              </button>
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
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-red-400">ログアウト</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-xs text-gray-500 leading-relaxed">{str.author_verify_desc}</p>

        {author && (
          <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <span className="text-xs text-gray-600">{author.display_name}</span>
            <span className="text-xs text-gray-400 ml-auto">{author.status}</span>
          </div>
        )}

        {/* 登録済み作品 — always visible when logged in */}
        {author && author.works.length > 0 && (
          <div className="border border-gray-100 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-gray-500 mb-2">登録済み作品</p>
            {author.works.map(w => (
              <div key={w.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-700 truncate">{w.title}</span>
                <span className={`text-xs shrink-0 ${w.status === "approved" ? "text-green-500" : "text-orange-400"}`}>
                  {w.status === "approved" ? "承認済" : "審査中"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 新規作品の登録 — depends on current tab */}
        {!workInfo ? (
          <div className="text-center py-6 space-y-1">
            <p className="text-sm text-gray-500">作品を登録するには</p>
            <p className="text-xs text-gray-400">カクヨムの作品ページを開いてください</p>
            <p className="text-xs text-gray-400">kakuyomu.jp/works/... または /my/works/...</p>
          </div>
        ) : step === "done" ? (
          <div className="space-y-3 text-center py-6">
            <div className="text-3xl">✓</div>
            <p className="text-sm font-medium text-green-700">作品を申請しました</p>
            <p className="text-xs text-gray-500">管理者の審査後、承認されます。</p>
            <button
              onClick={() => { setStep("idle"); setVerifyCode(""); setMsg(""); }}
              className="text-xs text-indigo-500 hover:underline"
            >
              別の作品を登録する
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-indigo-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">検出した作品</p>
              <p className="text-xs font-mono text-indigo-700 truncate">{workInfo.canonical}</p>
            </div>

            {step === "idle" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">作品タイトル（任意）</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="タイトルを入力（空欄でも可）"
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
                  {loading ? "申請中..." : "認証コードを申請"}
                </button>
              </div>
            )}

            {(step === "code" || step === "verifying") && (
              <div className="space-y-3">
                <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-gray-500">以下のコードを作品の「作品紹介」末尾に追記して保存してください：</p>
                  <code className="block text-indigo-600 font-mono text-sm bg-gray-50 rounded px-3 py-2 select-all">{verifyCode}</code>
                  <p className="text-xs text-gray-400">カクヨム：作品管理 → 作品紹介の末尾に追記して保存</p>
                </div>
                {msg && <p className="text-xs text-red-500">{msg}</p>}
                <button
                  onClick={handleVerify}
                  disabled={loading || step === "verifying"}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {step === "verifying" ? "確認中..." : "追記しました → 確認する"}
                </button>
                <button
                  onClick={() => { setStep("idle"); setVerifyCode(""); setMsg(""); }}
                  className="w-full text-xs text-gray-400 hover:text-gray-600"
                >
                  最初からやり直す
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

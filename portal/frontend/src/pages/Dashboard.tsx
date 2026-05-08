import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

type Status = "pending_email" | "email_verified" | "pending_manual_review" | "approved" | "rejected";

const STATUS_LABEL: Record<Status, { label: string; color: string }> = {
  pending_email:          { label: "メール未確認",     color: "text-yellow-400" },
  email_verified:         { label: "メール確認済",      color: "text-blue-400" },
  pending_manual_review:  { label: "審査待ち",          color: "text-orange-400" },
  approved:               { label: "承認済",            color: "text-green-400" },
  rejected:               { label: "拒否",              color: "text-red-400" },
};

interface AuthorStatus {
  author_id: string;
  display_name: string;
  status: Status;
  verify_code: string;
  note_url: string | null;
  works: Array<{ id: string; title: string; platform: string; slug: string; status: string }>;
}

export function DashboardPage() {
  const [params] = useSearchParams();
  const authorId = params.get("author_id") ?? "";

  const [data, setData] = useState<AuthorStatus | null>(null);
  const [error, setError] = useState("");
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [workForm, setWorkForm] = useState({ title: "", platform: "syosetu", platform_url: "", note_url: "", github_handle: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  useEffect(() => {
    if (!authorId) return;
    api.status(authorId).then(setData).catch(e => setError(String(e.message)));
  }, [authorId]);

  const handleWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setSubmitting(true);
    setSubmitMsg("");
    try {
      await api.registerWork(data.author_id, workForm.title, workForm.platform, workForm.platform_url, workForm.note_url, workForm.github_handle);
      setSubmitMsg("作品情報を送信しました。審査をお待ちください。");
      setShowWorkForm(false);
      const updated = await api.status(authorId);
      setData(updated);
    } catch (err) {
      setSubmitMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!authorId) {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center text-gray-400">
        <p>author_id がありません。登録ページからやり直してください。</p>
      </main>
    );
  }

  if (error) return (
    <main className="max-w-md mx-auto px-6 py-16 text-center text-red-400">{error}</main>
  );

  if (!data) return (
    <main className="max-w-md mx-auto px-6 py-16 text-center text-gray-500">読み込み中...</main>
  );

  const st = STATUS_LABEL[data.status] ?? { label: data.status, color: "text-gray-400" };

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.display_name}</h1>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{data.author_id}</p>
        </div>
        <span className={`text-sm font-semibold ${st.color}`}>{st.label}</span>
      </div>

      {/* Step indicator */}
      {data.status !== "approved" && data.status !== "rejected" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <Step n={1} done={data.status !== "pending_email"} label="メールアドレスの確認" />
          <Step n={2} done={["pending_manual_review", "approved"].includes(data.status)} label="作品情報と確認コードの提出">
            {data.status === "email_verified" && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-gray-300">
                  作品の「作者ノート」または「近状ノート」に以下のコードを投稿してください：
                </p>
                <code className="block bg-gray-800 rounded px-4 py-2 text-indigo-300 font-mono text-sm">
                  {data.verify_code}
                </code>
                <p className="text-xs text-gray-500">投稿後、下のフォームで作品情報と投稿URLを送信してください。</p>
              </div>
            )}
          </Step>
          <Step n={3} done={data.status === "approved"} label="管理者審査（数日以内）" />
        </div>
      )}

      {/* Work registration form */}
      {data.status === "email_verified" && (
        <div>
          <button
            className="text-indigo-400 text-sm hover:underline"
            onClick={() => setShowWorkForm(p => !p)}
          >
            {showWorkForm ? "▲ 閉じる" : "▼ 作品情報を入力する"}
          </button>
          {showWorkForm && (
            <form onSubmit={handleWorkSubmit} className="mt-4 space-y-4 bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div>
                <label className="block text-sm font-medium mb-1">作品タイトル</label>
                <input required className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={workForm.title} onChange={e => setWorkForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">プラットフォーム</label>
                <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  value={workForm.platform} onChange={e => setWorkForm(f => ({ ...f, platform: e.target.value }))}>
                  <option value="syosetu">小説家になろう</option>
                  <option value="kakuyomu">カクヨム</option>
                  <option value="other">その他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">作品URL</label>
                <input required type="url" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  placeholder="https://ncode.syosetu.com/..."
                  value={workForm.platform_url} onChange={e => setWorkForm(f => ({ ...f, platform_url: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">確認コードを投稿したノートのURL</label>
                <input required type="url" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  placeholder="https://ncode.syosetu.com/.../notice/..."
                  value={workForm.note_url} onChange={e => setWorkForm(f => ({ ...f, note_url: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">GitHubアカウント名（任意）</label>
                <input className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                  placeholder="your-github-handle"
                  value={workForm.github_handle} onChange={e => setWorkForm(f => ({ ...f, github_handle: e.target.value }))} />
                <p className="text-xs text-gray-500 mt-1">提供後、tensei-authorsのCODEOWNERS設定に追加されます。</p>
              </div>
              {submitMsg && <p className={`text-sm ${submitMsg.includes("送信") ? "text-green-400" : "text-red-400"}`}>{submitMsg}</p>}
              <button type="submit" disabled={submitting}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium">
                {submitting ? "送信中..." : "送信"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Approved: show works and character submit */}
      {data.status === "approved" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">登録作品</h2>
          {data.works.length === 0
            ? <p className="text-sm text-gray-400">作品がまだ登録されていません。</p>
            : data.works.map(w => (
              <div key={w.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{w.title}</p>
                  <span className="text-xs text-green-400">{w.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 font-mono">{w.slug}</p>
              </div>
            ))
          }
          <p className="text-sm text-gray-400">
            キャラクターJSONはExtensionの「JSON書出」からエクスポートし、GitHubのtensei-authorsリポジトリへPRを送ってください。
          </p>
        </div>
      )}

      {data.status === "rejected" && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-5 text-sm text-red-300">
          登録が拒否されました。詳細についてはお問い合わせください。
        </div>
      )}
    </main>
  );
}

function Step({ n, done, label, children }: { n: number; done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${done ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400"}`}>
        {done ? "✓" : n}
      </div>
      <div className="flex-1 pt-0.5">
        <p className={`text-sm font-medium ${done ? "text-gray-400 line-through" : "text-gray-100"}`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

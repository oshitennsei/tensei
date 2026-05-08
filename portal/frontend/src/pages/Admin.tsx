import { useState, useEffect } from "react";
import { api } from "../api";

interface Author {
  id: string;
  email: string;
  display_name: string;
  github_handle: string | null;
  status: string;
  verify_code?: string;
  note_url?: string | null;
  created_at: number;
  reviewed_at: number | null;
  admin_note: string | null;
}

export function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [ghHandles, setGhHandles] = useState<Record<string, string>>({});

  const load = async (s = secret) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.admin.all(s);
      setAuthors(data.authors as Author[]);
      setAuthed(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  const approve = async (id: string) => {
    setActionMsg("");
    try {
      await api.admin.approve(secret, id, ghHandles[id] ?? "");
      setActionMsg("承認しました。");
      await load();
    } catch (err) {
      setActionMsg(String(err instanceof Error ? err.message : err));
    }
  };

  const reject = async (id: string) => {
    setActionMsg("");
    const note = prompt("拒否理由（任意）：") ?? "";
    try {
      await api.admin.reject(secret, id, note || undefined);
      setActionMsg("拒否しました。");
      await load();
    } catch (err) {
      setActionMsg(String(err instanceof Error ? err.message : err));
    }
  };

  if (!authed) {
    return (
      <main className="max-w-sm mx-auto px-6 py-16">
        <h1 className="text-xl font-bold mb-6">管理者ログイン</h1>
        <input
          type="password"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm mb-3"
          placeholder="Admin secret"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") load(); }}
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button onClick={() => load()}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm">
          {loading ? "確認中..." : "ログイン"}
        </button>
      </main>
    );
  }

  const pending = authors.filter(a => ["pending_manual_review", "email_verified"].includes(a.status));
  const others = authors.filter(a => !["pending_manual_review", "email_verified"].includes(a.status));

  return (
    <main className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">管理パネル</h1>
        <button onClick={() => load()} className="text-sm text-indigo-400 hover:underline">更新</button>
      </div>

      {actionMsg && <p className="text-sm text-green-400 bg-green-900/20 rounded px-3 py-2">{actionMsg}</p>}

      {pending.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">審査待ち ({pending.length})</h2>
          <div className="space-y-4">
            {pending.map(a => (
              <div key={a.id} className="bg-gray-900 border border-yellow-800/50 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{a.display_name}</p>
                    <p className="text-sm text-gray-400">{a.email}</p>
                    <p className="text-xs text-gray-500 mt-1">登録: {new Date(a.created_at).toLocaleString("ja-JP")}</p>
                  </div>
                  <span className="text-xs text-orange-400 bg-orange-900/30 rounded px-2 py-1 shrink-0">{a.status}</span>
                </div>

                {a.verify_code && (
                  <div className="text-sm">
                    <span className="text-gray-500">確認コード: </span>
                    <code className="text-indigo-300 font-mono">{a.verify_code}</code>
                  </div>
                )}
                {a.note_url && (
                  <a href={a.note_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-indigo-400 hover:underline block truncate">
                    ノートURL: {a.note_url}
                  </a>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <input
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
                    placeholder="GitHubアカウント名（承認時に設定）"
                    value={ghHandles[a.id] ?? ""}
                    onChange={e => setGhHandles(h => ({ ...h, [a.id]: e.target.value }))}
                  />
                  <button onClick={() => approve(a.id)}
                    className="bg-green-700 hover:bg-green-600 text-white rounded px-4 py-1.5 text-sm font-medium">
                    承認
                  </button>
                  <button onClick={() => reject(a.id)}
                    className="bg-red-800 hover:bg-red-700 text-white rounded px-4 py-1.5 text-sm font-medium">
                    拒否
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">全著者 ({others.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-500 text-xs">
                  <th className="pb-2 pr-4">名前</th>
                  <th className="pb-2 pr-4">メール</th>
                  <th className="pb-2 pr-4">GitHub</th>
                  <th className="pb-2 pr-4">ステータス</th>
                  <th className="pb-2">登録日</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900">
                {others.map(a => (
                  <tr key={a.id}>
                    <td className="py-2 pr-4">{a.display_name}</td>
                    <td className="py-2 pr-4 text-gray-400">{a.email}</td>
                    <td className="py-2 pr-4 text-gray-400">{a.github_handle ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs ${a.status === "approved" ? "text-green-400" : "text-red-400"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">{new Date(a.created_at).toLocaleDateString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {authors.length === 0 && (
        <p className="text-gray-500 text-sm">著者がまだいません。</p>
      )}
    </main>
  );
}

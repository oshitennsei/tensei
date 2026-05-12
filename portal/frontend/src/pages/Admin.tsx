import { useState, useEffect } from "react";
import { api } from "../api";

interface PendingWork {
  id: string;
  title: string;
  platform: string;
  platform_url: string;
  slug: string;
  status: string;
  verify_snapshot: string | null;
  created_at: number;
  author_name: string;
  author_email: string;
}

function parseVerifySnapshot(snapshot: string | null): { pendingCode: string | null; autoVerified: boolean } {
  if (!snapshot) return { pendingCode: null, autoVerified: false };
  if (snapshot.startsWith("[verify-pending:")) {
    const m = snapshot.match(/code=([^;]+)/);
    return { pendingCode: m ? m[1] : null, autoVerified: false };
  }
  return { pendingCode: null, autoVerified: true };
}

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
  const [pendingWorks, setPendingWorks] = useState<PendingWork[]>([]);
  const [allWorks, setAllWorks] = useState<PendingWork[]>([]);
  const [noteCheckResults, setNoteCheckResults] = useState<Record<string, { verified: boolean; reason: string; checking: boolean }>>({});

  const load = async (s = secret) => {
    setLoading(true);
    setError("");
    try {
      const [authData, worksData, allWorksData] = await Promise.all([
        api.admin.all(s),
        api.admin.pendingWorks(s),
        api.admin.allWorks(s),
      ]);
      setAuthors(authData.authors as Author[]);
      setPendingWorks(worksData.works as PendingWork[]);
      setAllWorks(allWorksData.works as PendingWork[]);
      setAuthed(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  const checkNote = async (author_id: string) => {
    setNoteCheckResults(r => ({ ...r, [author_id]: { verified: false, reason: "", checking: true } }));
    try {
      const result = await api.admin.checkNote(secret, author_id);
      setNoteCheckResults(r => ({ ...r, [author_id]: { ...result, checking: false } }));
    } catch (err) {
      setNoteCheckResults(r => ({ ...r, [author_id]: { verified: false, reason: String(err instanceof Error ? err.message : err), checking: false } }));
    }
  };

  const suspendWork = async (work_id: string) => {
    setActionMsg("");
    try {
      await api.admin.suspendWork(secret, work_id);
      setActionMsg("作品を暂停しました。");
      await load();
    } catch (err) { setActionMsg(String(err instanceof Error ? err.message : err)); }
  };

  const restoreWork = async (work_id: string) => {
    setActionMsg("");
    try {
      await api.admin.restoreWork(secret, work_id);
      setActionMsg("作品を復元しました。");
      await load();
    } catch (err) { setActionMsg(String(err instanceof Error ? err.message : err)); }
  };

  const deleteWork = async (work_id: string, title: string) => {
    if (!window.confirm(`「${title}」を完全に削除しますか？この操作は取り消せません。`)) return;
    setActionMsg("");
    try {
      await api.admin.deleteWork(secret, work_id);
      setActionMsg("作品を削除しました。");
      await load();
    } catch (err) { setActionMsg(String(err instanceof Error ? err.message : err)); }
  };

  const approveWork = async (platform_url: string) => {
    setActionMsg("");
    try {
      await api.admin.approveWork(secret, platform_url);
      setActionMsg("作品を承認しました。");
      await load();
    } catch (err) {
      setActionMsg(String(err instanceof Error ? err.message : err));
    }
  };

  const approve = async (id: string, hasNoteUrl: boolean) => {
    setActionMsg("");
    const noteResult = noteCheckResults[id];
    if (hasNoteUrl && (!noteResult || (!noteResult.verified && !noteResult.checking))) {
      if (!window.confirm("ノートの確認コードをまだ確認していません。このまま承認しますか？")) return;
    }
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

      {pendingWorks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">作品審査待ち ({pendingWorks.length})</h2>
          <div className="space-y-3">
            {pendingWorks.map(w => (
              <div key={w.id} className="bg-gray-900 border border-blue-800/50 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{w.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{w.author_name} ({w.author_email})</p>
                    <a href={w.platform_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:underline truncate block mt-1">{w.platform_url}</a>
                    <p className="text-xs text-gray-600 mt-0.5">{new Date(w.created_at).toLocaleString("ja-JP")}</p>
                  </div>
                  <button onClick={() => approveWork(w.platform_url)}
                    className="shrink-0 bg-green-700 hover:bg-green-600 text-white rounded px-4 py-1.5 text-sm font-medium">
                    承認
                  </button>
                </div>
                {(() => {
                  const { pendingCode, autoVerified } = parseVerifySnapshot(w.verify_snapshot);
                  if (pendingCode) return (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-2 space-y-1">
                      <p className="text-xs text-yellow-400 font-semibold">⚠ 自動確認不可 — 手動確認が必要</p>
                      <p className="text-xs text-gray-300">作品紹介に以下のコードがあるか確認してください：</p>
                      <code className="block text-indigo-300 font-mono text-xs bg-gray-900 rounded px-2 py-1 select-all">{pendingCode}</code>
                    </div>
                  );
                  if (autoVerified) return (
                    <p className="text-xs text-green-400">✓ 自動確認済</p>
                  );
                  return null;
                })()}
              </div>
            ))}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">著者審査待ち ({pending.length})</h2>
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
                  <div className="space-y-1">
                    <a href={a.note_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-indigo-400 hover:underline block truncate">
                      ノートURL: {a.note_url}
                    </a>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => checkNote(a.id)}
                        disabled={noteCheckResults[a.id]?.checking}
                        className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded px-3 py-1"
                      >
                        {noteCheckResults[a.id]?.checking ? "確認中..." : "コード確認"}
                      </button>
                      {noteCheckResults[a.id] && !noteCheckResults[a.id].checking && (
                        <span className={`text-xs font-medium ${noteCheckResults[a.id].verified ? "text-green-400" : "text-red-400"}`}>
                          {noteCheckResults[a.id].verified ? "✓ " : "✗ "}{noteCheckResults[a.id].reason}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <input
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
                    placeholder="GitHubアカウント名（承認時に設定）"
                    value={ghHandles[a.id] ?? ""}
                    onChange={e => setGhHandles(h => ({ ...h, [a.id]: e.target.value }))}
                  />
                  <button onClick={() => approve(a.id, !!a.note_url)}
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

      {allWorks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">全作品管理 ({allWorks.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-500 text-xs">
                  <th className="pb-2 pr-3">タイトル</th>
                  <th className="pb-2 pr-3">著者</th>
                  <th className="pb-2 pr-3">プラットフォーム</th>
                  <th className="pb-2 pr-3">ステータス</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900">
                {allWorks.map(w => (
                  <tr key={w.id}>
                    <td className="py-2 pr-3">
                      <a href={w.platform_url} target="_blank" rel="noopener noreferrer"
                        className="text-indigo-400 hover:underline">{w.title}</a>
                    </td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">{w.author_name}</td>
                    <td className="py-2 pr-3 text-gray-500 text-xs">{w.platform}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-medium ${
                        w.status === "approved" ? "text-green-400" :
                        w.status === "suspended" ? "text-yellow-400" : "text-orange-400"
                      }`}>
                        {w.status === "approved" ? "承認済" : w.status === "suspended" ? "暫停中" : "審査待ち"}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {w.status === "approved" && (
                          <button onClick={() => suspendWork(w.id)}
                            className="text-xs bg-yellow-800 hover:bg-yellow-700 text-white rounded px-2 py-1">
                            暫停
                          </button>
                        )}
                        {w.status === "suspended" && (
                          <button onClick={() => restoreWork(w.id)}
                            className="text-xs bg-green-800 hover:bg-green-700 text-white rounded px-2 py-1">
                            復元
                          </button>
                        )}
                        <button onClick={() => deleteWork(w.id, w.title)}
                          className="text-xs bg-red-900 hover:bg-red-800 text-white rounded px-2 py-1">
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

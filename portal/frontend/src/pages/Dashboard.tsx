import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api, type PortalCharacter, type PortalChapterSummary, type LockedField } from "../api";

type AuthorStatus = "pending_email" | "email_verified" | "pending_manual_review" | "approved" | "rejected";

const STATUS_LABEL: Record<AuthorStatus, { label: string; color: string }> = {
  pending_email:          { label: "メール未確認",  color: "text-yellow-400" },
  email_verified:         { label: "メール確認済",   color: "text-blue-400" },
  pending_manual_review:  { label: "審査待ち",       color: "text-orange-400" },
  approved:               { label: "承認済",         color: "text-green-400" },
  rejected:               { label: "拒否",           color: "text-red-400" },
};

export function DashboardPage() {
  const { author, token, loading, refresh } = useAuth();
  const navigate = useNavigate();

  const [showWorkForm, setShowWorkForm] = useState(false);
  const [workStep, setWorkStep] = useState<"url" | "code" | "submit">("url");
  const [workForm, setWorkForm] = useState({ title: "", platform: "syosetu", platform_url: "", github_handle: "" });
  const [verifyCode, setVerifyCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  // Phase 6: character + summary management
  const [activeWorkId, setActiveWorkId] = useState<string | null>(null);
  const [workCharacters, setWorkCharacters] = useState<PortalCharacter[]>([]);
  const [workSummaries, setWorkSummaries] = useState<PortalChapterSummary[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentMsg, setContentMsg] = useState("");
  const [charFormOpen, setCharFormOpen] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [charForm, setCharForm] = useState({
    name: "", slug: "", persona: "", speech_style: "",
    will_not_do: "", forbidden_topics: "",
    locked_fields: [] as LockedField[],
  });
  const [summaryRows, setSummaryRows] = useState<Array<{ chapter_number: number; summary: string; locked: boolean; saving: boolean }>>([]);
  const [newSummaryRow, setNewSummaryRow] = useState({ chapter_number: "", summary: "", locked: false });

  const loadWorkContent = useCallback(async (workId: string) => {
    if (!token) return;
    setContentLoading(true); setContentMsg("");
    try {
      const [charRes, sumRes] = await Promise.all([
        api.getCharacters(workId),
        api.getSummaries(workId),
      ]);
      setWorkCharacters(charRes.characters);
      setWorkSummaries(sumRes.summaries);
      setSummaryRows(sumRes.summaries.map(s => ({ ...s, saving: false })));
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setContentLoading(false);
    }
  }, [token]);

  const toggleWorkManage = async (workId: string) => {
    if (activeWorkId === workId) {
      setActiveWorkId(null); setCharFormOpen(false); return;
    }
    setActiveWorkId(workId);
    setCharFormOpen(false);
    setEditingSlug(null);
    await loadWorkContent(workId);
  };

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

  const openCharForm = (char?: PortalCharacter) => {
    if (char) {
      setEditingSlug(char.slug);
      setCharForm({
        name: char.name, slug: char.slug,
        persona: char.data.persona ?? "",
        speech_style: char.data.speech_style ?? "",
        will_not_do: (char.data.will_not_do ?? []).join("\n"),
        forbidden_topics: (char.data.forbidden_topics ?? []).join("\n"),
        locked_fields: char.locked_fields,
      });
    } else {
      setEditingSlug(null);
      setCharForm({ name: "", slug: "", persona: "", speech_style: "", will_not_do: "", forbidden_topics: "", locked_fields: [] });
    }
    setCharFormOpen(true);
  };

  const toggleLockedField = (field: LockedField) => {
    setCharForm(f => ({
      ...f,
      locked_fields: f.locked_fields.includes(field)
        ? f.locked_fields.filter(x => x !== field)
        : [...f.locked_fields, field],
    }));
  };

  const handleSaveChar = async () => {
    if (!token || !activeWorkId || !charForm.name.trim()) return;
    const slug = charForm.slug.trim() || slugify(charForm.name);
    setContentMsg("");
    try {
      await api.putCharacter(token, activeWorkId, slug, {
        name: charForm.name.trim(),
        data: {
          persona: charForm.persona || undefined,
          speech_style: charForm.speech_style || undefined,
          will_not_do: charForm.will_not_do ? charForm.will_not_do.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
          forbidden_topics: charForm.forbidden_topics ? charForm.forbidden_topics.split("\n").map(s => s.trim()).filter(Boolean) : undefined,
        },
        locked_fields: charForm.locked_fields,
      });
      setCharFormOpen(false);
      await loadWorkContent(activeWorkId);
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
    }
  };

  const handleDeleteChar = async (workId: string, slug: string) => {
    if (!token) return;
    if (!confirm(`「${slug}」を削除しますか？`)) return;
    setContentMsg("");
    try {
      await api.deleteCharacter(token, workId, slug);
      await loadWorkContent(workId);
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
    }
  };

  const handleSaveSummaryRow = async (workId: string, idx: number) => {
    if (!token) return;
    const row = summaryRows[idx];
    setSummaryRows(rows => rows.map((r, i) => i === idx ? { ...r, saving: true } : r));
    try {
      await api.putSummary(token, workId, row.chapter_number, { summary: row.summary, locked: row.locked });
      setSummaryRows(rows => rows.map((r, i) => i === idx ? { ...r, saving: false } : r));
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
      setSummaryRows(rows => rows.map((r, i) => i === idx ? { ...r, saving: false } : r));
    }
  };

  const handleDeleteSummaryRow = async (workId: string, idx: number) => {
    if (!token) return;
    const row = summaryRows[idx];
    if (!confirm(`第${row.chapter_number}章のサマリーを削除しますか？`)) return;
    try {
      await api.deleteSummary(token, workId, row.chapter_number);
      setSummaryRows(rows => rows.filter((_, i) => i !== idx));
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
    }
  };

  const handleAddSummaryRow = async (workId: string) => {
    if (!token) return;
    const num = parseInt(newSummaryRow.chapter_number, 10);
    if (isNaN(num) || num < 1 || !newSummaryRow.summary.trim()) return;
    try {
      await api.putSummary(token, workId, num, { summary: newSummaryRow.summary.trim(), locked: newSummaryRow.locked });
      setNewSummaryRow({ chapter_number: "", summary: "", locked: false });
      await loadWorkContent(workId);
    } catch (e) {
      setContentMsg(String(e instanceof Error ? e.message : e));
    }
  };

  if (loading) return (
    <main className="max-w-md mx-auto px-6 py-16 text-center text-gray-500">読み込み中...</main>
  );

  if (!author || !token) {
    navigate("/login", { replace: true });
    return null;
  }

  const status = author.status as AuthorStatus;
  const st = STATUS_LABEL[status] ?? { label: status, color: "text-gray-400" };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg("");
    try {
      const res = await api.requestCode(token, workForm.platform_url, workForm.platform);
      setVerifyCode(res.code);
      setWorkStep("code");
    } catch (err) {
      setSubmitMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleWorkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg("");
    try {
      await api.registerWork(token, workForm.title, workForm.platform, workForm.platform_url, workForm.github_handle || undefined);
      setSubmitMsg("作品情報を送信しました。審査をお待ちください。");
      setShowWorkForm(false);
      setWorkStep("url");
      setWorkForm({ title: "", platform: "syosetu", platform_url: "", github_handle: "" });
      setVerifyCode("");
      await refresh();
    } catch (err) {
      setSubmitMsg(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{author.display_name}</h1>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">{author.author_id}</p>
        </div>
        <span className={`text-sm font-semibold ${st.color}`}>{st.label}</span>
      </div>

      {/* Progress steps */}
      {status !== "approved" && status !== "rejected" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <Step n={1} done={status !== "pending_email"} label="メールアドレスの確認" />
          <Step n={2} done={["pending_manual_review", "approved"].includes(status)} label="作品情報と確認コードの提出">
            {status === "email_verified" && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-gray-300">
                  作品の「作者ノート」または「近状ノート」に以下のコードを投稿してください：
                </p>
                <code className="block bg-gray-800 rounded px-4 py-2 text-indigo-300 font-mono text-sm">
                  {author.verify_code}
                </code>
                <p className="text-xs text-gray-500">投稿後、下のフォームで作品情報と投稿URLを送信してください。</p>
              </div>
            )}
          </Step>
          <Step n={3} done={status === "approved"} label="管理者審査（数日以内）" />
        </div>
      )}

      {/* Work registration form — for email_verified OR approved authors */}
      {(status === "email_verified" || status === "approved") && (
        <div>
          <button
            className="text-indigo-400 text-sm hover:underline"
            onClick={() => setShowWorkForm(p => !p)}
          >
            {showWorkForm ? "▲ 閉じる" : "▼ 作品を追加する"}
          </button>
          {showWorkForm && (
            <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              {/* Step indicator */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className={workStep === "url" ? "text-indigo-400 font-semibold" : "line-through"}>① 作品URL</span>
                <span>→</span>
                <span className={workStep === "code" ? "text-indigo-400 font-semibold" : workStep === "submit" ? "line-through" : ""}>② コード投稿</span>
                <span>→</span>
                <span className={workStep === "submit" ? "text-indigo-400 font-semibold" : ""}>③ 申請送信</span>
              </div>

              {/* Step 1: Enter work URL and request code */}
              {workStep === "url" && (
                <form onSubmit={handleRequestCode} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">プラットフォーム</label>
                    <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                      value={workForm.platform} onChange={e => setWorkForm(f => ({ ...f, platform: e.target.value }))}>
                      <option value="syosetu">小説家になろう</option>
                      <option value="kakuyomu">カクヨム</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">作品URL</label>
                    <input required type="url" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                      placeholder={workForm.platform === "kakuyomu" ? "https://kakuyomu.jp/works/..." : "https://ncode.syosetu.com/n.../"}
                      value={workForm.platform_url} onChange={e => setWorkForm(f => ({ ...f, platform_url: e.target.value }))} />
                  </div>
                  {submitMsg && <p className="text-sm text-red-400">{submitMsg}</p>}
                  <button type="submit" disabled={submitting}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium">
                    {submitting ? "申請中..." : "認証コードを申請"}
                  </button>
                </form>
              )}

              {/* Step 2: Show code, instruct author to post it */}
              {workStep === "code" && (
                <div className="space-y-4">
                  <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                    <p className="text-sm text-gray-300">
                      {workForm.platform === "syosetu"
                        ? "以下のコードを作品の「近況ノート」に投稿してください："
                        : "以下のコードを「作品紹介」の末尾に追記して保存してください："}
                    </p>
                    <code className="block text-indigo-300 font-mono text-sm bg-gray-900 rounded px-4 py-2 select-all">{verifyCode}</code>
                    <p className="text-xs text-gray-500">
                      {workForm.platform === "syosetu"
                        ? "小説家になろう：作品管理 → 近況ノート（または作者ノート）に投稿"
                        : "カクヨム：作品管理 → 作品紹介の末尾にコードを追記して保存"}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400">投稿が完了したら「次へ」を押してください。（コードの有効期限：7日間）</p>
                  <div className="flex gap-3">
                    <button onClick={() => { setWorkStep("url"); setSubmitMsg(""); }}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 text-sm">
                      戻る
                    </button>
                    <button onClick={() => { setWorkStep("submit"); setSubmitMsg(""); }}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded px-4 py-2 text-sm font-medium">
                      投稿しました →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Fill title and submit */}
              {workStep === "submit" && (
                <form onSubmit={handleWorkSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">作品タイトル</label>
                    <input required className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                      value={workForm.title} onChange={e => setWorkForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">GitHubアカウント名（任意）</label>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                      placeholder="your-github-handle"
                      value={workForm.github_handle} onChange={e => setWorkForm(f => ({ ...f, github_handle: e.target.value }))} />
                  </div>
                  <p className="text-xs text-gray-500">送信すると、システムが作者ノートのコードを自動確認します。</p>
                  {submitMsg && (
                    <p className={`text-sm ${submitMsg.includes("送信") ? "text-green-400" : "text-red-400"}`}>{submitMsg}</p>
                  )}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { setWorkStep("code"); setSubmitMsg(""); }}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 text-sm">
                      戻る
                    </button>
                    <button type="submit" disabled={submitting}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium">
                      {submitting ? "確認中..." : "送信・認証"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* Works list */}
      {author.works.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-300">登録作品</h2>
          {author.works.map(w => (
            <div key={w.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{w.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{w.platform_url}</p>
                </div>
                <span className={`text-xs shrink-0 ${w.status === "approved" ? "text-green-400" : "text-orange-400"}`}>
                  {w.status === "approved" ? "承認済" : "審査待ち"}
                </span>
              </div>

              {w.status === "approved" && (
                <button
                  className="text-indigo-400 text-xs hover:underline"
                  onClick={() => toggleWorkManage(w.id)}
                >
                  {activeWorkId === w.id ? "▲ 閉じる" : "▼ キャラクター・サマリーを管理"}
                </button>
              )}

              {activeWorkId === w.id && (
                <div className="space-y-5 pt-1">
                  {contentLoading && <p className="text-xs text-gray-500">読み込み中...</p>}
                  {contentMsg && <p className="text-xs text-red-400">{contentMsg}</p>}

                  {/* ── キャラクター管理 ── */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">キャラクター</p>
                      <button
                        className="text-xs text-indigo-400 hover:underline"
                        onClick={() => { setCharFormOpen(p => !p); if (charFormOpen) setEditingSlug(null); }}
                      >
                        {charFormOpen ? "閉じる" : "＋ 追加"}
                      </button>
                    </div>

                    {workCharacters.length === 0 && !charFormOpen && (
                      <p className="text-xs text-gray-600">登録なし</p>
                    )}

                    {workCharacters.map(char => (
                      <div key={char.slug} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                        <div>
                          <span className="text-sm text-gray-200">{char.name}</span>
                          <span className="text-xs text-gray-500 ml-2">/{char.slug}</span>
                          {char.locked_fields.length > 0 && (
                            <span className="ml-2 text-xs text-yellow-500">🔒 {char.locked_fields.join(", ")}</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button className="text-xs text-indigo-400 hover:underline" onClick={() => openCharForm(char)}>編集</button>
                          <button className="text-xs text-red-400 hover:underline" onClick={() => handleDeleteChar(w.id, char.slug)}>削除</button>
                        </div>
                      </div>
                    ))}

                    {charFormOpen && (
                      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                        <p className="text-xs font-semibold text-gray-300">{editingSlug ? "キャラクターを編集" : "キャラクターを追加"}</p>
                        <div className="space-y-2">
                          <input required className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                            placeholder="名前 *" value={charForm.name}
                            onChange={e => setCharForm(f => ({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) }))} />
                          <input className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
                            placeholder="スラッグ (自動生成)" value={charForm.slug}
                            onChange={e => setCharForm(f => ({ ...f, slug: e.target.value }))} />
                          <textarea rows={3} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                            placeholder="ペルソナ" value={charForm.persona}
                            onChange={e => setCharForm(f => ({ ...f, persona: e.target.value }))} />
                          <input className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                            placeholder="話し方" value={charForm.speech_style}
                            onChange={e => setCharForm(f => ({ ...f, speech_style: e.target.value }))} />
                          <textarea rows={2} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                            placeholder="やらないこと（1行1項目）" value={charForm.will_not_do}
                            onChange={e => setCharForm(f => ({ ...f, will_not_do: e.target.value }))} />
                          <textarea rows={2} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                            placeholder="禁止トピック（1行1項目）" value={charForm.forbidden_topics}
                            onChange={e => setCharForm(f => ({ ...f, forbidden_topics: e.target.value }))} />
                          <div className="space-y-1">
                            <p className="text-xs text-gray-400">ロックするフィールド（読者は変更不可）</p>
                            <div className="flex flex-wrap gap-2">
                              {(["persona", "speech_style", "will_not_do", "forbidden_topics"] as LockedField[]).map(f => (
                                <label key={f} className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                                  <input type="checkbox" checked={charForm.locked_fields.includes(f)} onChange={() => toggleLockedField(f)} />
                                  {f}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setCharFormOpen(false); setEditingSlug(null); }}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5 text-sm">
                            キャンセル
                          </button>
                          <button onClick={handleSaveChar} disabled={!charForm.name.trim()}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-1.5 text-sm font-medium">
                            保存
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── 章サマリー管理 ── */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">章サマリー</p>

                    {summaryRows.length === 0 && (
                      <p className="text-xs text-gray-600">登録なし</p>
                    )}

                    {summaryRows.map((row, idx) => (
                      <div key={row.chapter_number} className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">第{row.chapter_number}章</span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                              <input type="checkbox" checked={row.locked}
                                onChange={e => setSummaryRows(rows => rows.map((r, i) => i === idx ? { ...r, locked: e.target.checked } : r))} />
                              ロック
                            </label>
                            <button className="text-xs text-red-400 hover:underline" onClick={() => handleDeleteSummaryRow(w.id, idx)}>削除</button>
                          </div>
                        </div>
                        <textarea rows={3} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                          value={row.summary}
                          onChange={e => setSummaryRows(rows => rows.map((r, i) => i === idx ? { ...r, summary: e.target.value } : r))} />
                        <button onClick={() => handleSaveSummaryRow(w.id, idx)} disabled={row.saving}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-1.5 text-xs font-medium">
                          {row.saving ? "保存中..." : "保存"}
                        </button>
                      </div>
                    ))}

                    {/* 新しい章を追加 */}
                    <div className="bg-gray-800 border border-dashed border-gray-600 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-gray-500">＋ 章を追加</p>
                      <input type="number" min={1} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                        placeholder="章番号" value={newSummaryRow.chapter_number}
                        onChange={e => setNewSummaryRow(r => ({ ...r, chapter_number: e.target.value }))} />
                      <textarea rows={3} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
                        placeholder="サマリー本文" value={newSummaryRow.summary}
                        onChange={e => setNewSummaryRow(r => ({ ...r, summary: e.target.value }))} />
                      <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={newSummaryRow.locked}
                          onChange={e => setNewSummaryRow(r => ({ ...r, locked: e.target.checked }))} />
                        ロック（読者は変更不可）
                      </label>
                      <button
                        onClick={() => handleAddSummaryRow(w.id)}
                        disabled={!newSummaryRow.chapter_number || !newSummaryRow.summary.trim()}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-1.5 text-xs font-medium">
                        追加
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {status === "rejected" && (
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

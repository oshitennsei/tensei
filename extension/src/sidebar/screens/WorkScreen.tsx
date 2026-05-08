import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { listSessions, deleteSession } from "@/lib/memory";
import { deleteWork } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Session, Entity } from "@/lib/storage";
import { getWorkBackgroundState, setWorkBackground, setWorkBackgroundValue, clearWorkBackground, GRADIENT_PRESETS, DEFAULT_BG } from "@/lib/background";
import { useBackground } from "../context/BackgroundContext";

interface Props {
  work: Work;
  onBack: () => void;
  onSelectSession: (session: Session) => void;
  onNewChat: () => void;
  onManageCharacters: () => void;
  onWorkDeleted: () => void;
}

export function WorkScreen({ work, onBack, onSelectSession, onNewChat, onManageCharacters, onWorkDeleted }: Props) {
  const { loadBackground } = useBackground();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [workBgState, setWorkBgState] = useState<{ image: string | null; value: string | null }>({ image: null, value: null });
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [bgColorInput, setBgColorInput] = useState("#1a1a2e");
  const bgFileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [sess, chars] = await Promise.all([
      listSessions(work.id),
      db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
    ]);
    setSessions(sess);
    setCharacters(chars);
  };

  useEffect(() => {
    reload();
    getWorkBackgroundState(work.id).then(setWorkBgState);
  }, [work.id]);

  const refreshWorkBg = async () => {
    const state = await getWorkBackgroundState(work.id);
    setWorkBgState(state);
    loadBackground(work.id);
  };

  const handleWorkBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await setWorkBackground(work.id, file);
    await refreshWorkBg();
  };

  const handleWorkBgValue = async (value: string) => {
    await setWorkBackgroundValue(work.id, value);
    await refreshWorkBg();
  };

  const handleClearWorkBg = async () => {
    await clearWorkBackground(work.id);
    await refreshWorkBg();
  };

  const characterName = (id: string) =>
    characters.find(c => c.id === id)?.canonical_name ?? "キャラクター";

  const lastMessage = (session: Session): string => {
    const turns = session.tier_0_recent_turns;
    if (turns.length === 0) return "（まだメッセージなし）";
    const last = turns[turns.length - 1];
    const preview = last.content.slice(0, 40);
    return preview.length < last.content.length ? preview + "…" : preview;
  };

  const relativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "今";
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}時間前`;
    const d = Math.floor(h / 24);
    return `${d}日前`;
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleDownloadSession = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    const charName = characterName(s.character_id);
    const lines = [
      `作品: ${work.title}`,
      `キャラクター: ${charName}`,
      `第${s.cutoff_chapter}章まで`,
      `開始: ${new Date(s.started_at).toLocaleString("ja-JP")}`,
      "",
      "--- 会話ログ ---",
      "",
      ...s.tier_0_recent_turns.map(t =>
        `[${t.role === "user" ? "読者" : charName}]\n${t.content}`
      ),
    ];
    if (s.tier_1_paragraph_summaries.length > 0) {
      lines.push("", "--- 圧縮済み要約 ---");
      s.tier_1_paragraph_summaries.forEach((sum, i) => {
        lines.push(`\n[要約 ${i + 1}]`, ...sum.key_exchanges);
      });
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${work.title}_${charName}_${s.id.slice(0, 6)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteWork = async () => {
    if (!confirm(`「${work.title}」とすべての会話記録を削除しますか？`)) return;
    setDeleting(true);
    await deleteWork(work.id);
    onWorkDeleted();
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{work.title}</p>
          <p className="text-xs text-gray-400">{work.author}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowBgPanel(p => !p)} title="背景画像">
          🖼
        </Button>
        <Button variant="danger" size="sm" disabled={deleting} onClick={handleDeleteWork}>
          削除
        </Button>
      </header>

      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleWorkBgUpload} />

      {showBgPanel && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/90 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">この作品の背景（全局設定を上書き）</p>
          </div>

          {/* Current preview */}
          <div
            className="w-full h-12 rounded relative overflow-hidden flex items-center justify-center"
            style={{ background: workBgState.image ? `url(${workBgState.image}) center/cover no-repeat` : (workBgState.value ?? DEFAULT_BG) }}
          >
            {!workBgState.image && !workBgState.value && (
              <span className="text-white/60 text-xs">全局設定を使用</span>
            )}
            {(workBgState.image || workBgState.value) && (
              <button
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs leading-none"
                onClick={handleClearWorkBg}
                title="リセット（全局設定に戻す）"
              >×</button>
            )}
          </div>

          {/* Image upload */}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => bgFileRef.current?.click()}>
            {workBgState.image ? "画像を変更" : "+ 画像をアップロード"}
          </Button>

          {/* Gradient presets */}
          <div className="grid grid-cols-4 gap-1">
            {GRADIENT_PRESETS.map(p => (
              <button
                key={p.value}
                className={`h-7 rounded text-xs text-white/70 hover:ring-2 ring-white/40 transition-all ${
                  workBgState.value === p.value && !workBgState.image ? "ring-2 ring-indigo-400" : ""
                }`}
                style={{ background: p.value }}
                title={p.label}
                onClick={() => handleWorkBgValue(p.value)}
              />
            ))}
          </div>

          {/* Solid color */}
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="w-7 h-7 rounded cursor-pointer border border-gray-300 shrink-0"
              value={bgColorInput}
              onChange={e => setBgColorInput(e.target.value)}
            />
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleWorkBgValue(bgColorInput)}>
              素色を適用
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Action buttons */}
        <div className="p-4 space-y-2 border-b border-gray-100">
          <Button className="w-full" onClick={onNewChat}>
            + 新しいチャットを始める
          </Button>
          <Button variant="ghost" className="w-full" onClick={onManageCharacters}>
            キャラクターを管理
          </Button>
        </div>

        {/* Session list */}
        {sessions.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-12 px-4">
            <p>まだ会話がありません。</p>
            <p className="mt-1 text-xs">上のボタンからキャラクターと話しかけてみましょう。</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sessions.map(s => (
              <li
                key={s.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => onSelectSession(s)}
              >
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold text-sm shrink-0">
                  {characterName(s.character_id).slice(0, 1)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium truncate">{characterName(s.character_id)}</p>
                    <p className="text-xs text-gray-400 ml-2 shrink-0">{relativeTime(s.last_active)}</p>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{lastMessage(s)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">第{s.cutoff_chapter}章まで</p>
                </div>

                <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400"
                    onClick={e => handleDownloadSession(e, s)}
                    title="ダウンロード"
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-red-500"
                    onClick={e => handleDeleteSession(e, s.id)}
                    title="削除"
                  >
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

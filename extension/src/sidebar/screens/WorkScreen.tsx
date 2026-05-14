import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { listSessions, deleteSession } from "@/lib/memory";
import { deleteWork } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Session, Entity, PerformanceSession } from "@/lib/storage";
import { getWorkBackgroundState, setWorkBackground, setWorkBackgroundValue, clearWorkBackground, GRADIENT_PRESETS, DEFAULT_BG } from "@/lib/background";
import { useBackground } from "../context/BackgroundContext";
import { useStrings } from "@/lib/i18n";
import {
  getPortalSession, portalMe, portalGetCharacters, portalGetSummaries, portalPutCharacters,
  portalCheckWorkLink, type PortalAuthor,
} from "@/lib/portal";

interface Props {
  work: Work;
  onBack: () => void;
  onSelectSession: (session: Session) => void;
  onNewChat: () => void;
  onManageCharacters: () => void;
  onWorkDeleted: () => void;
  onPerformance: () => void;
  onResumePerformance: (session: PerformanceSession) => void;
}

export function WorkScreen({ work, onBack, onSelectSession, onNewChat, onManageCharacters, onWorkDeleted, onPerformance, onResumePerformance }: Props) {
  const str = useStrings();
  const { loadBackground } = useBackground();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [perfSessions, setPerfSessions] = useState<PerformanceSession[]>([]);
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [workBgState, setWorkBgState] = useState<{ image: string | null; value: string | null }>({ image: null, value: null });
  const [portalSession, setPortalSession] = useState<string | null>(null);
  const [portalAuthor, setPortalAuthor] = useState<PortalAuthor | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [bgColorInput, setBgColorInput] = useState("#1a1a2e");
  const bgFileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [sess, perf, chars] = await Promise.all([
      listSessions(work.id),
      db.performance_sessions.where("work_id").equals(work.id).sortBy("last_active"),
      db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
    ]);
    setSessions(sess);
    setPerfSessions(perf.reverse());
    setCharacters(chars);
  };

  useEffect(() => {
    reload();
    getWorkBackgroundState(work.id).then(setWorkBgState);
    getPortalSession().then(async token => {
      if (!token) return;
      const me = await portalMe(token);
      if (me) { setPortalSession(token); setPortalAuthor(me); }
    }).catch(() => {});
    // Auto-link portal_work_id by platform_url if not yet set
    if (!work.portal_work_id && work.platform_url) {
      portalCheckWorkLink(work.platform_url).then(async portalWorkId => {
        if (portalWorkId) {
          await db.works.update(work.id, { portal_work_id: portalWorkId });
        }
      }).catch(() => {});
    }
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
    characters.find(c => c.id === id)?.canonical_name ?? str.work_char_default;

  const lastMessage = (session: Session): string => {
    const turns = session.tier_0_recent_turns;
    if (turns.length === 0) return str.work_no_messages;
    const last = turns[turns.length - 1];
    const preview = last.content.slice(0, 40);
    return preview.length < last.content.length ? preview + "…" : preview;
  };

  const relativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return str.work_time_now;
    if (m < 60) return str.work_time_min(m);
    const h = Math.floor(m / 60);
    if (h < 24) return str.work_time_hour(h);
    const d = Math.floor(h / 24);
    return str.work_time_day(d);
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleDeletePerfSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await db.performance_sessions.delete(id);
    setPerfSessions(prev => prev.filter(s => s.id !== id));
  };

  const perfSessionPreview = (s: PerformanceSession): string => {
    if (s.generated_content.length === 0) return str.work_no_messages;
    const last = s.generated_content[s.generated_content.length - 1].content;
    const preview = last.slice(0, 50);
    return preview.length < last.length ? preview + "…" : preview;
  };

  const perfSessionChars = (s: PerformanceSession): string =>
    s.characters_in_scene
      .map(id => characters.find(c => c.id === id)?.canonical_name ?? "?")
      .join("、");

  const handleDownloadSession = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    const charName = characterName(s.character_id);
    const lines = [
      `${str.work_work_label}: ${work.title}`,
      `${str.work_char_label}: ${charName}`,
      str.work_chapter_up_to(s.cutoff_chapter),
      `${new Date(s.started_at).toLocaleString()}`,
      "",
      str.work_log_header,
      "",
      ...s.tier_0_recent_turns.map(t =>
        `[${t.role === "user" ? str.work_log_reader : charName}]\n${t.content}`
      ),
    ];
    if (s.tier_1_paragraph_summaries.length > 0) {
      lines.push("", str.work_summary_header);
      s.tier_1_paragraph_summaries.forEach((sum, i) => {
        lines.push(`\n${str.work_summary_label(i + 1)}`, ...sum.key_exchanges);
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
    if (!confirm(str.work_delete_confirm(work.title))) return;
    setDeleting(true);
    await deleteWork(work.id);
    onWorkDeleted();
  };

  const isAuthorOfThisWork =
    portalAuthor != null &&
    work.portal_work_id != null &&
    portalAuthor.works.some(w => w.id === work.portal_work_id);

  const handleSyncFromPortal = async () => {
    if (!work.portal_work_id) return;
    setSyncing(true); setSyncMsg("");
    try {
      const [portalChars, portalSummaries] = await Promise.all([
        portalGetCharacters(work.portal_work_id),
        portalGetSummaries(work.portal_work_id),
      ]);

      if (portalChars.length === 0 && portalSummaries.length === 0) {
        setSyncMsg("ポータルにデータがありません。");
        return;
      }

      const charNames = portalChars.map(c => c.name).join("、");
      const confirmMsg =
        "以下を上書きします：\n" +
        (charNames ? `• キャラクター設定: ${charNames}\n` : "") +
        (portalSummaries.length > 0 ? `• 章サマリー: ${portalSummaries.length}件\n` : "") +
        "\n※ チャット履歴・ボイスサンプルは保持されます。よろしいですか？";
      if (!confirm(confirmMsg)) return;

      // Apply characters
      const allEntities = await db.entities
        .where("work_id").equals(work.id)
        .filter(e => e.type === "character").toArray();
      const allExts = await db.characters_extended.where("work_id").equals(work.id).toArray();
      const extMap = new Map(allExts.map(e => [e.id, e]));

      for (const portalChar of portalChars) {
        const entity = allEntities.find(
          e => e.canonical_name.trim().toLowerCase() === portalChar.name.trim().toLowerCase(),
        );
        if (!entity) continue;
        const existing = extMap.get(entity.id);
        if (!existing) continue;

        await db.characters_extended.update(entity.id, {
          persona: portalChar.data.persona ?? existing.persona,
          speech_style: portalChar.data.speech_style ?? existing.speech_style,
          will_do: portalChar.data.will_do ?? existing.will_do,
          will_not_do: portalChar.data.will_not_do ?? existing.will_not_do,
          forbidden_topics: portalChar.data.forbidden_topics ?? existing.forbidden_topics,
          dialogue_examples: portalChar.data.dialogue_examples ?? existing.dialogue_examples,
          state_snapshots: (portalChar.data.state_snapshots as typeof existing.state_snapshots | undefined) ?? existing.state_snapshots,
          // Preserve reader's voice samples; use portal's only if reader has none
          voice_samples: existing.voice_samples.length > 0
            ? existing.voice_samples
            : (portalChar.data.voice_samples ?? existing.voice_samples),
          author_provided: true,
          locked_fields: portalChar.locked_fields,
          author_authorization_id: portalChar.id,
        });
      }

      // Apply chapter summaries
      for (const ps of portalSummaries) {
        const chapter = await db.chapters
          .where("[work_id+chapter_number]")
          .equals([work.id, ps.chapter_number])
          .first();
        if (chapter) {
          await db.chapters.update(chapter.id, { author_summary: ps.summary });
        }
      }

      setSyncMsg(`取得完了。キャラクター${portalChars.length}件・章サマリー${portalSummaries.length}件。`);
    } catch (e) {
      setSyncMsg(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePushToPortal = async () => {
    if (!portalSession || !work.portal_work_id) return;
    setSyncing(true); setSyncMsg("");
    try {
      const allEntities = await db.entities
        .where("work_id").equals(work.id)
        .filter(e => e.type === "character").toArray();
      const allExts = await db.characters_extended.where("work_id").equals(work.id).toArray();
      const extMap = new Map(allExts.map(e => [e.id, e]));

      const payload = allEntities
        .filter(e => extMap.has(e.id))
        .map(e => {
          const ext = extMap.get(e.id)!;
          const slug = e.canonical_name.toLowerCase()
            .replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
          return {
            slug,
            name: e.canonical_name,
            data: {
              persona: ext.persona,
              speech_style: ext.speech_style,
              will_do: ext.will_do,
              will_not_do: ext.will_not_do,
              forbidden_topics: ext.forbidden_topics,
              voice_samples: ext.voice_samples,
              dialogue_examples: ext.dialogue_examples,
              state_snapshots: ext.state_snapshots as unknown[],
            },
            locked_fields: ext.locked_fields ?? [],
          };
        });

      await portalPutCharacters(portalSession, work.portal_work_id, payload);
      setSyncMsg(`${payload.length}件のキャラクターをポータルに送信しました。`);
    } catch (e) {
      setSyncMsg(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
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
          {str.work_delete_btn}
        </Button>
      </header>

      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleWorkBgUpload} />

      {showBgPanel && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/90 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">{str.work_bg_panel_title}</p>
          </div>

          <div
            className="w-full h-12 rounded relative overflow-hidden flex items-center justify-center"
            style={{ background: workBgState.image ? `url(${workBgState.image}) center/cover no-repeat` : (workBgState.value ?? DEFAULT_BG) }}
          >
            {!workBgState.image && !workBgState.value && (
              <span className="text-white/60 text-xs">{str.work_bg_default}</span>
            )}
            {(workBgState.image || workBgState.value) && (
              <button
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs leading-none"
                onClick={handleClearWorkBg}
              >×</button>
            )}
          </div>

          <Button variant="ghost" size="sm" className="w-full" onClick={() => bgFileRef.current?.click()}>
            {workBgState.image ? str.work_bg_change : str.work_bg_upload}
          </Button>

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

          <div className="flex items-center gap-2">
            <input
              type="color"
              className="w-7 h-7 rounded cursor-pointer border border-gray-300 shrink-0"
              value={bgColorInput}
              onChange={e => setBgColorInput(e.target.value)}
            />
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => handleWorkBgValue(bgColorInput)}>
              {str.work_bg_apply_color}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2 border-b border-gray-100">
          <Button className="w-full" onClick={onNewChat}>
            {str.work_new_chat}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onPerformance}>
            {str.work_new_performance}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onManageCharacters}>
            {str.work_manage_chars}
          </Button>
          {work.portal_work_id && (
            <>
              <Button variant="ghost" className="w-full" onClick={handleSyncFromPortal} disabled={syncing}>
                {syncing ? "取得中..." : "作者版を取得"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() =>
                chrome.tabs.create({ url: "https://tensei-portal.pages.dev/dashboard" })
              }>
                ポータルを開く
              </Button>
            </>
          )}
          {isAuthorOfThisWork && (
            <Button variant="ghost" className="w-full" onClick={handlePushToPortal} disabled={syncing}>
              {syncing ? "送信中..." : "ポータルに送信"}
            </Button>
          )}
          {syncMsg && <p className="text-xs text-gray-500 text-center">{syncMsg}</p>}
        </div>

        {/* Performance sessions */}
        {perfSessions.length > 0 && (
          <div className="border-b border-gray-100">
            <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {str.work_perf_sessions_header}
            </p>
            <ul className="divide-y divide-gray-100">
              {perfSessions.map(s => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onResumePerformance(s)}
                >
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-semibold text-sm shrink-0">
                    ▶
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm font-medium truncate">{perfSessionChars(s)}</p>
                      <p className="text-xs text-gray-400 ml-2 shrink-0">{relativeTime(s.last_active)}</p>
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{perfSessionPreview(s)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.generated_content.length} beats</p>
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-400 hover:text-red-500"
                      onClick={e => handleDeletePerfSession(e, s.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-12 px-4">
            <p>{str.work_no_sessions}</p>
            <p className="mt-1 text-xs">{str.work_no_sessions_hint}</p>
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
                  <p className="text-xs text-gray-400 mt-0.5">{str.work_chapter_up_to(s.cutoff_chapter)}</p>
                </div>

                <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400"
                    onClick={e => handleDownloadSession(e, s)}
                    title="↓"
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-red-500"
                    onClick={e => handleDeleteSession(e, s.id)}
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

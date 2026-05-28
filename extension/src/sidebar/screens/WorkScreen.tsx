import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/storage";
import type { Work, Session, Entity, PerformanceSession } from "@/lib/storage";
import { listSessions, deleteSession } from "@/lib/memory";
import { deleteWork } from "@/lib/ingestion";
import { getWorkBackgroundState, setWorkBackground, setWorkBackgroundValue, clearWorkBackground, GRADIENT_PRESETS, DEFAULT_BG } from "@/lib/background";
import { useBackground } from "../context/BackgroundContext";
import { useStrings } from "@/lib/i18n";
import {
  getPortalSession, portalMe, portalGetCharacters, portalGetSummaries, portalPutCharacters,
  portalCheckWorkLink, type PortalAuthor,
} from "@/lib/portal";

// ─── Palette (matches HomeScreen / 転生学校) ─────────────────────────────────
const C = {
  bg:          "#080a14",
  cardBg:      "rgba(13,13,36,0.85)",
  border:      "rgba(99,102,241,0.18)",
  borderHover: "rgba(99,102,241,0.5)",
  gold:        "#d4af37",
  indigo:      "#818cf8",
  indigoDim:   "rgba(99,102,241,0.15)",
  text:        "#e2e8f0",
  muted:       "#64748b",
  mutedLight:  "#94a3b8",
  danger:      "rgba(239,68,68,0.85)",
};

interface Props {
  work: Work;
  onBack: () => void;
  onSelectSession: (session: Session) => void;
  onNewChat: () => void;
  onManageCharacters: () => void;
  onManageEntities: () => void;
  onManageEvents: () => void;
  onWorkDeleted: () => void;
  onPerformance: () => void;
  onResumePerformance: (session: PerformanceSession) => void;
  onIngest: () => void;
  onDataManage: () => void;
}

type AnySession =
  | { kind: "chat"; data: Session }
  | { kind: "perf"; data: PerformanceSession };

// ─── Sub-components ───────────────────────────────────────────────────────────

function IconBtn({ onClick, icon, title }: { onClick: () => void; icon: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all duration-150"
      style={{ color: C.muted }}
      onMouseEnter={e => { e.currentTarget.style.color = C.indigo; e.currentTarget.style.background = C.indigoDim; }}
      onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
    </button>
  );
}

function SectionLabel({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-2">
      <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: C.muted }}>{label}</p>
      {action && onAction && (
        <button
          className="text-xs transition-colors"
          style={{ color: C.muted }}
          onMouseEnter={e => (e.currentTarget.style.color = C.indigo)}
          onMouseLeave={e => (e.currentTarget.style.color = C.muted)}
          onClick={onAction}
        >
          {action} ›
        </button>
      )}
    </div>
  );
}

function ActionCard({ icon, label, sub, onClick }: { icon: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150"
      style={{ background: C.cardBg, border: `1px solid ${C.border}` }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = C.borderHover;
        e.currentTarget.style.boxShadow = "0 0 16px rgba(99,102,241,0.1)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.boxShadow = "none";
      }}
      onClick={onClick}
    >
      <span className="text-xl w-8 text-center shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-medium" style={{ color: C.text }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: C.muted }}>{sub}</p>}
      </div>
    </button>
  );
}

function ManageBtn({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl transition-all duration-150"
      style={{ background: C.cardBg, border: `1px solid ${danger ? "rgba(239,68,68,0.2)" : C.border}` }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = danger ? "rgba(239,68,68,0.5)" : C.borderHover;
        e.currentTarget.style.boxShadow = `0 0 12px ${danger ? "rgba(239,68,68,0.08)" : "rgba(99,102,241,0.08)"}`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = danger ? "rgba(239,68,68,0.2)" : C.border;
        e.currentTarget.style.boxShadow = "none";
      }}
      onClick={onClick}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-xs" style={{ color: danger ? C.danger : C.mutedLight }}>{label}</span>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkScreen({
  work, onBack, onSelectSession, onNewChat, onManageCharacters,
  onManageEntities, onManageEvents, onWorkDeleted, onPerformance,
  onResumePerformance, onIngest, onDataManage,
}: Props) {
  const str = useStrings();
  const { loadBackground } = useBackground();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [perfSessions, setPerfSessions] = useState<PerformanceSession[]>([]);
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [workBgState, setWorkBgState] = useState<{ image: string | null; value: string | null }>({ image: null, value: null });
  const [portalSession, setPortalSession] = useState<string | null>(null);
  const [portalAuthor, setPortalAuthor] = useState<PortalAuthor | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showBgPanel, setShowBgPanel] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [bgColorInput, setBgColorInput] = useState("#1a1a2e");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleting, setDeleting] = useState(false);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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
    if (!work.portal_work_id && work.platform_url) {
      portalCheckWorkLink(work.platform_url).then(async portalWorkId => {
        if (portalWorkId) await db.works.update(work.id, { portal_work_id: portalWorkId });
      }).catch(() => {});
    }
  }, [work.id]);

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const characterName = (id: string) =>
    characters.find(c => c.id === id)?.canonical_name ?? str.work_char_default;

  const relativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return str.work_time_now;
    if (m < 60) return str.work_time_min(m);
    const h = Math.floor(m / 60);
    if (h < 24) return str.work_time_hour(h);
    return str.work_time_day(Math.floor(h / 24));
  };

  const chatTitle = (s: Session): string => {
    if (s.title) return s.title;
    const firstUser = s.tier_0_recent_turns.find(t => t.role === "user");
    if (firstUser) return firstUser.content.slice(0, 28).trimEnd();
    return characterName(s.character_id);
  };

  const perfTitle = (s: PerformanceSession): string => {
    if (s.title) return s.title;
    if (s.scene_directive) return s.scene_directive.slice(0, 28).trimEnd();
    const chars = s.characters_in_scene.map(id => characterName(id)).filter(Boolean);
    return chars.slice(0, 3).join("・") || str.work_new_performance;
  };

  // Merge + filter empty + sort by last_active
  const combined: AnySession[] = [
    ...sessions
      .filter(s => s.tier_0_recent_turns.length > 0 || s.tier_1_paragraph_summaries.length > 0)
      .map(s => ({ kind: "chat" as const, data: s })),
    ...perfSessions
      .filter(s => s.generated_content.length > 0)
      .map(s => ({ kind: "perf" as const, data: s })),
  ].sort((a, b) => b.data.last_active - a.data.last_active);

  // ── Rename ───────────────────────────────────────────────────────────────────

  const startRename = (e: React.MouseEvent, id: string, current: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(current);
  };

  const commitRename = async (kind: "chat" | "perf", id: string) => {
    const trimmed = editTitle.trim();
    if (kind === "chat") {
      await db.sessions.update(id, { title: trimmed || undefined });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed || undefined } : s));
    } else {
      await db.performance_sessions.update(id, { title: trimmed || undefined });
      setPerfSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed || undefined } : s));
    }
    setEditingId(null);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(str.session_delete_confirm)) return;
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleDeletePerfSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(str.session_delete_confirm)) return;
    await db.performance_sessions.delete(id);
    setPerfSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleDeleteWork = async () => {
    if (!confirm(str.work_delete_confirm(work.title))) return;
    setDeleting(true);
    await deleteWork(work.id);
    onWorkDeleted();
  };

  // ── Download ─────────────────────────────────────────────────────────────────

  const handleDownloadSession = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    const charName = characterName(s.character_id);
    const lines = [
      `${str.work_work_label}: ${work.title}`,
      `${str.work_char_label}: ${charName}`,
      str.work_chapter_up_to(s.cutoff_chapter),
      new Date(s.started_at).toLocaleString(),
      "",
      str.work_log_header,
      "",
      ...s.tier_0_recent_turns.map(t =>
        `[${t.role === "user" ? str.work_log_reader : charName}]\n${t.content}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${work.title}_${charName}_${s.id.slice(0, 6)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Background ───────────────────────────────────────────────────────────────

  const refreshBg = async () => {
    const state = await getWorkBackgroundState(work.id);
    setWorkBgState(state);
    loadBackground(work.id);
  };

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await setWorkBackground(work.id, file);
    await refreshBg();
  };

  const handleBgValue = async (value: string) => {
    await setWorkBackgroundValue(work.id, value);
    await refreshBg();
  };

  // ── Portal sync ───────────────────────────────────────────────────────────────

  const isAuthorOfThisWork =
    portalAuthor != null && work.portal_work_id != null &&
    portalAuthor.works.some(w => w.id === work.portal_work_id);

  const handleSyncFromPortal = async () => {
    if (!work.portal_work_id) return;
    setShowMoreMenu(false);
    setSyncing(true); setSyncMsg("");
    try {
      const [portalChars, portalSummaries] = await Promise.all([
        portalGetCharacters(work.portal_work_id),
        portalGetSummaries(work.portal_work_id),
      ]);
      if (portalChars.length === 0 && portalSummaries.length === 0) {
        setSyncMsg("ポータルにデータがありません。"); return;
      }
      const confirmMsg =
        "以下を上書きします：\n" +
        (portalChars.length > 0 ? `• キャラクター設定: ${portalChars.map(c => c.name).join("、")}\n` : "") +
        (portalSummaries.length > 0 ? `• 章サマリー: ${portalSummaries.length}件\n` : "") +
        "\n※ チャット履歴・ボイスサンプルは保持されます。";
      if (!confirm(confirmMsg)) return;

      const allEntities = await db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray();
      const allExts = await db.characters_extended.where("work_id").equals(work.id).toArray();
      const extMap = new Map(allExts.map(e => [e.id, e]));

      for (const pc of portalChars) {
        const entity = allEntities.find(e => e.canonical_name.trim().toLowerCase() === pc.name.trim().toLowerCase());
        if (!entity) continue;
        const existing = extMap.get(entity.id);
        if (!existing) continue;
        await db.characters_extended.update(entity.id, {
          persona: pc.data.persona ?? existing.persona,
          speech_style: pc.data.speech_style ?? existing.speech_style,
          will_do: pc.data.will_do ?? existing.will_do,
          will_not_do: pc.data.will_not_do ?? existing.will_not_do,
          forbidden_topics: pc.data.forbidden_topics ?? existing.forbidden_topics,
          dialogue_examples: pc.data.dialogue_examples ?? existing.dialogue_examples,
          state_snapshots: (pc.data.state_snapshots as typeof existing.state_snapshots | undefined) ?? existing.state_snapshots,
          voice_samples: existing.voice_samples.length > 0 ? existing.voice_samples : (pc.data.voice_samples ?? existing.voice_samples),
          author_provided: true,
          locked_fields: pc.locked_fields,
          author_authorization_id: pc.id,
        });
      }
      for (const ps of portalSummaries) {
        const chapter = await db.chapters.where("[work_id+chapter_number]").equals([work.id, ps.chapter_number]).first();
        if (chapter) await db.chapters.update(chapter.id, { author_summary: ps.summary });
      }
      setSyncMsg(`取得完了。キャラクター${portalChars.length}件・サマリー${portalSummaries.length}件。`);
    } catch (e) {
      setSyncMsg(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePushToPortal = async () => {
    if (!portalSession || !work.portal_work_id) return;
    setShowMoreMenu(false);
    setSyncing(true); setSyncMsg("");
    try {
      const allEntities = await db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray();
      const allExts = await db.characters_extended.where("work_id").equals(work.id).toArray();
      const extMap = new Map(allExts.map(e => [e.id, e]));
      const payload = allEntities.filter(e => extMap.has(e.id)).map(e => {
        const ext = extMap.get(e.id)!;
        const slug = e.canonical_name.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
        return {
          slug, name: e.canonical_name,
          data: { persona: ext.persona, speech_style: ext.speech_style, will_do: ext.will_do, will_not_do: ext.will_not_do, forbidden_topics: ext.forbidden_topics, voice_samples: ext.voice_samples, dialogue_examples: ext.dialogue_examples, state_snapshots: ext.state_snapshots as unknown[] },
          locked_fields: ext.locked_fields ?? [],
        };
      });
      await portalPutCharacters(portalSession, work.portal_work_id, payload);
      setSyncMsg(`${payload.length}件をポータルに送信しました。`);
    } catch (e) {
      setSyncMsg(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const heroBg = workBgState.image
    ? `url(${workBgState.image}) center/cover no-repeat`
    : (workBgState.value ?? DEFAULT_BG);

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg, color: C.text }}>
      {/* ── Hidden inputs ── */}
      <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />

      {/* ── Header ── */}
      <header
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,10,20,0.97)" }}
      >
        <IconBtn onClick={onBack} icon="←" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{work.title}</p>
          {work.author && <p className="text-xs truncate" style={{ color: C.muted }}>{work.author}</p>}
        </div>
        <IconBtn onClick={() => setShowBgPanel(p => !p)} icon="🖼" title={str.work_bg_panel_title} />
        {work.portal_work_id && (
          <div className="relative">
            <IconBtn onClick={() => setShowMoreMenu(p => !p)} icon="···" />
            {showMoreMenu && (
              <div
                className="absolute right-0 top-9 z-30 rounded-xl py-1 min-w-[180px] shadow-2xl"
                style={{ background: "rgba(13,13,36,0.98)", border: `1px solid ${C.border}` }}
              >
                <MenuRow icon="⬇" label={syncing ? "取得中..." : "作者版を取得"} onClick={handleSyncFromPortal} disabled={syncing} />
                <MenuRow icon="🌐" label="ポータルを開く" onClick={() => {
                  const url = "https://tensei-portal.pages.dev/dashboard";
                  if (typeof chrome !== "undefined" && chrome.tabs) chrome.tabs.create({ url });
                  else window.open(url, "_blank");
                  setShowMoreMenu(false);
                }} />
                {isAuthorOfThisWork && (
                  <MenuRow icon="⬆" label={syncing ? "送信中..." : "ポータルに送信"} onClick={handlePushToPortal} disabled={syncing} />
                )}
                {syncMsg && <p className="px-4 py-1 text-xs" style={{ color: C.muted }}>{syncMsg}</p>}
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── Background panel ── */}
      {showBgPanel && (
        <div className="px-4 py-3 space-y-2 shrink-0" style={{ background: "rgba(13,13,36,0.9)", borderBottom: `1px solid ${C.border}` }}>
          <div className="w-full h-10 rounded-lg relative overflow-hidden" style={{ background: heroBg }}>
            {(workBgState.image || workBgState.value) && (
              <button className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs" onClick={() => clearWorkBackground(work.id).then(refreshBg)}>×</button>
            )}
          </div>
          <button
            className="w-full py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: C.indigoDim, border: `1px solid ${C.border}`, color: C.indigo }}
            onClick={() => bgFileRef.current?.click()}
          >
            {workBgState.image ? str.work_bg_change : str.work_bg_upload}
          </button>
          <div className="grid grid-cols-4 gap-1">
            {GRADIENT_PRESETS.map(p => (
              <button
                key={p.value}
                className={`h-6 rounded transition-all ${workBgState.value === p.value && !workBgState.image ? "ring-2 ring-indigo-400" : ""}`}
                style={{ background: p.value }}
                title={p.label}
                onClick={() => handleBgValue(p.value)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input type="color" className="w-7 h-7 rounded border border-gray-600 cursor-pointer shrink-0" value={bgColorInput} onChange={e => setBgColorInput(e.target.value)} />
            <button
              className="flex-1 py-1 rounded-lg text-xs transition-colors"
              style={{ background: C.indigoDim, border: `1px solid ${C.border}`, color: C.indigo }}
              onClick={() => handleBgValue(bgColorInput)}
            >
              {str.work_bg_apply_color}
            </button>
          </div>
        </div>
      )}

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto" onClick={() => { setShowMoreMenu(false); }}>

        {/* ── Hero band ── */}
        <div
          className="relative shrink-0"
          style={{ height: 56, background: heroBg }}
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,10,20,0.85) 0%, transparent 60%)" }} />
        </div>

        {/* ── Characters row ── */}
        {characters.length > 0 && (
          <div>
            <SectionLabel label={str.work_chars_section} action={str.work_action_manage} onAction={onManageCharacters} />
            <div className="flex gap-2 px-4 pb-1 overflow-x-auto no-scrollbar">
              {characters.slice(0, 8).map(c => (
                <button
                  key={c.id}
                  className="flex flex-col items-center gap-1 shrink-0 transition-opacity hover:opacity-80"
                  onClick={onManageCharacters}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold"
                    style={{
                      background: `hsl(${charHue(c.id)},40%,18%)`,
                      border: `1px solid hsl(${charHue(c.id)},50%,35%)`,
                      color: `hsl(${charHue(c.id)},70%,70%)`,
                    }}
                  >
                    {c.canonical_name.slice(0, 1)}
                  </div>
                  <p className="text-xs w-12 text-center truncate" style={{ color: C.muted }}>{c.canonical_name}</p>
                </button>
              ))}
              {characters.length > 8 && (
                <button className="flex flex-col items-center gap-1 shrink-0 opacity-50 hover:opacity-80" onClick={onManageCharacters}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs" style={{ background: C.indigoDim, border: `1px solid ${C.border}`, color: C.muted }}>
                    +{characters.length - 8}
                  </div>
                  <p className="text-xs w-12 text-center" style={{ color: C.muted }}>他</p>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Primary actions ── */}
        <div className="px-4 pt-4 pb-2 space-y-2">
          <ActionCard icon="💬" label={str.work_new_chat} onClick={onNewChat} />
          <ActionCard icon="🎭" label={str.work_new_performance} onClick={onPerformance} />
        </div>

        {/* ── Sessions (combined) ── */}
        {combined.length > 0 && (
          <div>
            <SectionLabel label={str.work_sessions_section} />
            <div className="px-4 pb-2 space-y-2">
              {combined.map(item => (
                item.kind === "chat"
                  ? <ChatCard
                      key={item.data.id}
                      session={item.data}
                      title={chatTitle(item.data)}
                      charName={characterName(item.data.character_id)}
                      time={relativeTime(item.data.last_active)}
                      editing={editingId === item.data.id}
                      editValue={editTitle}
                      editRef={editInputRef}
                      onEdit={e => startRename(e, item.data.id, chatTitle(item.data))}
                      onEditChange={setEditTitle}
                      onEditCommit={() => commitRename("chat", item.data.id)}
                      onEditCancel={() => setEditingId(null)}
                      onClick={() => onSelectSession(item.data)}
                      onDelete={e => handleDeleteSession(e, item.data.id)}
                      onDownload={e => handleDownloadSession(e, item.data)}
                      str={str}
                    />
                  : <PerfCard
                      key={item.data.id}
                      session={item.data}
                      title={perfTitle(item.data)}
                      time={relativeTime(item.data.last_active)}
                      beats={item.data.generated_content.length}
                      editing={editingId === item.data.id}
                      editValue={editTitle}
                      editRef={editInputRef}
                      onEdit={e => startRename(e, item.data.id, perfTitle(item.data))}
                      onEditChange={setEditTitle}
                      onEditCommit={() => commitRename("perf", item.data.id)}
                      onEditCancel={() => setEditingId(null)}
                      onClick={() => onResumePerformance(item.data)}
                      onDelete={e => handleDeletePerfSession(e, item.data.id)}
                    />
              ))}
            </div>
          </div>
        )}

        {combined.length === 0 && (
          <div className="text-center py-10 px-4">
            <p className="text-sm" style={{ color: C.muted }}>{str.work_no_sessions}</p>
            <p className="text-xs mt-1" style={{ color: C.muted }}>{str.work_no_sessions_hint}</p>
          </div>
        )}

        {/* ── Manage section (collapsible) ── */}
        <div className="px-4 pt-4 pb-6">
          <button
            className="w-full flex items-center justify-between py-2 mb-2"
            onClick={() => setShowManage(p => !p)}
          >
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: C.muted }}>{str.work_manage_section}</p>
            <span className="text-xs" style={{ color: C.muted }}>{showManage ? "▲" : "▼"}</span>
          </button>
          {showManage && (
            <div className="space-y-2">
              <ActionCard icon="👥" label={str.work_manage_chars}   sub={str.work_manage_chars_desc}    onClick={onManageCharacters} />
              <ActionCard icon="📍" label={str.work_manage_entities} sub={str.work_manage_entities_desc} onClick={onManageEntities} />
              <ActionCard icon="📅" label={str.work_manage_events}  sub={str.work_manage_events_desc}   onClick={onManageEvents} />
              <ActionCard icon="➕" label={str.work_add_chapters}   sub={str.work_add_chapters_desc}    onClick={onIngest} />
              <ActionCard icon="🔧" label={str.work_data_label}     sub={str.work_data_desc}            onClick={onDataManage} />
              <button
                className="w-full py-2.5 rounded-xl text-sm transition-all mt-1"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)", color: C.danger }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
                disabled={deleting}
                onClick={handleDeleteWork}
              >
                {deleting ? "削除中..." : str.work_delete_btn + ` 「${work.title}」`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper: deterministic hue from id ───────────────────────────────────────
function charHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

// ─── Menu row ────────────────────────────────────────────────────────────────
function MenuRow({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors disabled:opacity-40"
      style={{ color: "rgba(226,232,240,0.8)" }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "rgba(99,102,241,0.1)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────
interface ChatCardProps {
  session: Session;
  title: string;
  charName: string;
  time: string;
  editing: boolean;
  editValue: string;
  editRef: React.RefObject<HTMLInputElement>;
  onEdit: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent) => void;
  str: ReturnType<typeof useStrings>;
}

function ChatCard({ session, title, charName, time, editing, editValue, editRef, onEdit, onEditChange, onEditCommit, onEditCancel, onClick, onDelete, onDownload }: ChatCardProps) {
  return (
    <div
      className="rounded-xl flex items-center gap-3 px-3 py-3 cursor-pointer transition-all duration-150"
      style={{ background: "rgba(13,13,36,0.8)", border: "1px solid rgba(99,102,241,0.15)" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.38)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.15)"; }}
      onClick={onClick}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
        style={{ background: `hsl(${charHue(session.character_id)},40%,18%)`, color: `hsl(${charHue(session.character_id)},70%,70%)` }}
      >
        {charName.slice(0, 1)}
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={editRef}
            className="w-full text-sm bg-transparent outline-none border-b pb-0.5"
            style={{ color: "rgba(226,232,240,0.9)", borderColor: "rgba(99,102,241,0.5)" }}
            value={editValue}
            onChange={e => onEditChange(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={e => { if (e.key === "Enter") onEditCommit(); if (e.key === "Escape") onEditCancel(); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <p className="text-sm font-medium truncate" style={{ color: "rgba(226,232,240,0.9)" }}>{title}</p>
        )}
        <p className="text-xs truncate mt-0.5" style={{ color: "rgba(99,102,241,0.7)" }}>
          {charName} · {time}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        <button className="w-6 h-6 flex items-center justify-center text-xs opacity-40 hover:opacity-80 transition-opacity" style={{ color: "rgba(226,232,240,0.8)" }} onClick={onEdit} title="タイトルを編集">✎</button>
        <button className="w-6 h-6 flex items-center justify-center text-xs opacity-40 hover:opacity-80 transition-opacity" style={{ color: "rgba(226,232,240,0.8)" }} onClick={onDownload} title="↓">↓</button>
        <button className="w-6 h-6 flex items-center justify-center text-xs opacity-40 hover:opacity-80 transition-opacity" style={{ color: "rgba(239,68,68,0.8)" }} onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

// ─── Performance card ─────────────────────────────────────────────────────────
interface PerfCardProps {
  session: PerformanceSession;
  title: string;
  time: string;
  beats: number;
  editing: boolean;
  editValue: string;
  editRef: React.RefObject<HTMLInputElement>;
  onEdit: (e: React.MouseEvent) => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function PerfCard({ session, title, time, beats, editing, editValue, editRef, onEdit, onEditChange, onEditCommit, onEditCancel, onClick, onDelete }: PerfCardProps) {
  return (
    <div
      className="rounded-xl flex items-center gap-3 px-3 py-3 cursor-pointer transition-all duration-150"
      style={{ background: "rgba(30,10,46,0.8)", border: "1px solid rgba(139,92,246,0.18)" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.45)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.18)"; }}
      onClick={onClick}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: "rgba(139,92,246,0.15)", color: "rgba(167,139,250,0.9)" }}>
        🎭
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={editRef}
            className="w-full text-sm bg-transparent outline-none border-b pb-0.5"
            style={{ color: "rgba(226,232,240,0.9)", borderColor: "rgba(139,92,246,0.5)" }}
            value={editValue}
            onChange={e => onEditChange(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={e => { if (e.key === "Enter") onEditCommit(); if (e.key === "Escape") onEditCancel(); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <p className="text-sm font-medium truncate" style={{ color: "rgba(226,232,240,0.9)" }}>{title}</p>
        )}
        <p className="text-xs mt-0.5" style={{ color: "rgba(139,92,246,0.7)" }}>
          🎭 演出 · {beats} beats · {time}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        <button className="w-6 h-6 flex items-center justify-center text-xs opacity-40 hover:opacity-80 transition-opacity" style={{ color: "rgba(226,232,240,0.8)" }} onClick={onEdit} title="タイトルを編集">✎</button>
        <button className="w-6 h-6 flex items-center justify-center text-xs opacity-40 hover:opacity-80 transition-opacity" style={{ color: "rgba(239,68,68,0.8)" }} onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

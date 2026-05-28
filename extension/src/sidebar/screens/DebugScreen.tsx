import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { listWorks, listChapters, reanalyzeWork, reembedWork, resolveEntities, generateMissingPersonas, enrichEvents } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Chapter, Entity, Session } from "@/lib/storage";
import { exportWork, downloadManifest, getEmbeddingStats } from "@/lib/storage/export";
import type { EmbeddingStats } from "@/lib/storage/export";
import { parseExportFile, analyzeImport, importWork } from "@/lib/storage/import";
import type { ParsedImport, ConflictAction, ImportResult } from "@/lib/storage/import";
import { getEmbedder } from "@/lib/embedding";
import { useStrings } from "@/lib/i18n";

interface MaintProgress {
  type: "analyze" | "embed" | "resolve" | "persona" | "enrich_events";
  done: number;
  total: number;
  current: string;
  blockInfo?: string;
  errors: string[];
  finished: boolean;
  mergeCount?: number;
}

interface ExportState {
  include_text: boolean;
  include_embeddings: boolean;
  exporting: boolean;
}

interface ImportState {
  phase: "confirm" | "importing" | "done" | "error";
  parsed?: ParsedImport;
  conflict_action: ConflictAction;
  result?: ImportResult;
  error?: string;
}

interface Props {
  onBack: () => void;
  initialWork?: Work;
}

export function DebugScreen({ onBack, initialWork }: Props) {
  const str = useStrings();
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWork, setSelectedWork] = useState<Work | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null);
  const [maint, setMaint] = useState<MaintProgress | null>(null);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [exportCreator, setExportCreator] = useState("");
  const [exportLabel, setExportLabel] = useState("");
  const [embeddingStats, setEmbeddingStats] = useState<EmbeddingStats | null>(null);
  const [embedTest, setEmbedTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [chatDebugSessions, setChatDebugSessions] = useState<Session[]>([]);
  const [expandedDebugSession, setExpandedDebugSession] = useState<string | null>(null);
  const [chatDebugCleared, setChatDebugCleared] = useState(false);
  const abortRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listWorks().then(ws => {
      setWorks(ws);
      if (initialWork) setSelectedWork(initialWork);
    });
  }, []);

  useEffect(() => {
    if (!selectedWork) {
      setChapters([]); setCharacters([]); setEmbeddingStats(null);
      setChatDebugSessions([]); setExpandedDebugSession(null);
      return;
    }
    setEmbeddingStats(null);
    Promise.all([
      listChapters(selectedWork.id),
      db.entities.where("work_id").equals(selectedWork.id).toArray(),
      getEmbeddingStats(selectedWork.id),
      db.sessions.where("work_id").equals(selectedWork.id).toArray(),
    ]).then(([chs, ents, stats, sessions]) => {
      setChapters(chs);
      setCharacters(ents);
      setEmbeddingStats(stats);
      setExpandedChapter(null);
      setChatDebugSessions(sessions.filter(s => s.tier_0_recent_turns.some(t => t.debug_prompt)));
      setExpandedDebugSession(null);
    });
  }, [selectedWork]);

  const characterName = (id: string) =>
    characters.find(c => c.id === id)?.canonical_name ?? id.slice(0, 8) + "…";

  const handleRemoveAlias = async (entityId: string, alias: string) => {
    const entity = characters.find(c => c.id === entityId);
    if (!entity) return;
    const newAliases = entity.aliases.filter(a => a !== alias);
    await db.entities.update(entityId, { aliases: newAliases });
    setCharacters(cs => cs.map(c => c.id === entityId ? { ...c, aliases: newAliases } : c));
  };

  // ── Chat debug ───────────────────────────────────────────────────────────────

  const handleClearChatDebug = async () => {
    if (!selectedWork) return;
    const sessions = await db.sessions.where("work_id").equals(selectedWork.id).toArray();
    for (const s of sessions) {
      const cleaned = s.tier_0_recent_turns.map(t => {
        const { debug_prompt: _dp, ...rest } = t;
        return rest;
      });
      await db.sessions.update(s.id, { tier_0_recent_turns: cleaned });
    }
    setChatDebugSessions([]);
    setExpandedDebugSession(null);
    setChatDebugCleared(true);
    setTimeout(() => setChatDebugCleared(false), 2000);
  };

  // ── Maintenance ──────────────────────────────────────────────────────────────

  const runMaint = async (type: "analyze" | "embed" | "resolve" | "persona" | "enrich_events") => {
    if (!selectedWork || maint) return;
    abortRef.current = false;
    setMaint({ type, done: 0, total: 0, current: "", errors: [], finished: false });

    const onProgress = (done: number, total: number, current: string) => {
      if (abortRef.current) return;
      setMaint(m => m ? { ...m, done, total, current, finished: done === total && total > 0 } : null);
    };
    const onError = (msg: string) => {
      setMaint(m => m ? { ...m, errors: [...m.errors, msg] } : null);
    };

    if (type === "analyze") {
      const onBlockProgress = (block: number, total: number) => {
        setMaint(m => m ? {
          ...m,
          blockInfo: total > 1 && block > 0 ? `ブロック ${block}/${total}` : undefined,
        } : null);
      };
      await reanalyzeWork(selectedWork.id, onProgress, onError, onBlockProgress);
      const chs = await listChapters(selectedWork.id);
      setChapters(chs);
    } else if (type === "embed") {
      setEmbedTest({ state: "testing" });
      try {
        const embedder = await getEmbedder();
        if (!embedder) {
          setEmbedTest({ state: "fail", msg: "Embeddingモデルが設定されていません（設定 → ロール割り当て → 埋め込み）" });
          setMaint(null);
          return;
        }
        const testVec = await embedder(["test"]);
        setEmbedTest({ state: "ok", msg: `接続OK（次元数: ${testVec[0].length}）` });
      } catch (e) {
        setEmbedTest({ state: "fail", msg: String(e) });
        setMaint(null);
        return;
      }
      await reembedWork(selectedWork.id, onProgress, onError);
      const stats = await getEmbeddingStats(selectedWork.id);
      setEmbeddingStats(stats);
    } else if (type === "resolve") {
      setMaint(m => m ? { ...m, total: 1 } : null);
      const count = await resolveEntities(
        selectedWork.id,
        (status) => setMaint(m => m ? { ...m, current: status } : null),
        onError,
      );
      setMaint(m => m ? { ...m, done: 1, current: "", finished: true, mergeCount: count } : null);
      const [chs, ents] = await Promise.all([
        listChapters(selectedWork.id),
        db.entities.where("work_id").equals(selectedWork.id).toArray(),
      ]);
      setChapters(chs);
      setCharacters(ents);
      return;
    } else if (type === "persona") {
      const count = await generateMissingPersonas(selectedWork.id, onProgress, onError);
      setMaint(m => m ? { ...m, done: m.total || count, current: "", finished: true, mergeCount: count } : null);
      return;
    } else if (type === "enrich_events") {
      const count = await enrichEvents(
        selectedWork.id,
        (done, total, current) => setMaint(m => m ? { ...m, done, total, current, finished: done === total && total > 0 } : null),
        onError,
      );
      setMaint(m => m ? { ...m, done: m.total || count, current: "", finished: true, mergeCount: count } : null);
      return;
    }
    setMaint(m => m ? { ...m, finished: true } : null);
  };

  // ── Export ────────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!selectedWork || !exportState) return;
    setExportState(s => s ? { ...s, exporting: true } : null);
    try {
      const manifest = await exportWork(selectedWork.id, {
        include_text: exportState.include_text,
        include_embeddings: exportState.include_embeddings,
        creator: exportCreator,
        label: exportLabel,
      });
      downloadManifest(manifest);
      setExportState(null);
    } catch (e) {
      alert(String(e));
      setExportState(s => s ? { ...s, exporting: false } : null);
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────────

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const json = await file.text();
      const manifest = parseExportFile(json);
      const parsed = await analyzeImport(manifest);
      setImportState({
        phase: "confirm",
        parsed,
        conflict_action: parsed.existing_work ? "overwrite" : "create_new",
      });
    } catch (err) {
      setImportState({ phase: "error", conflict_action: "create_new", error: String(err) });
    }
  };

  const handleImportConfirm = async () => {
    if (!importState?.parsed) return;
    setImportState(s => s ? { ...s, phase: "importing" } : null);
    try {
      const result = await importWork(importState.parsed, {
        conflict_action: importState.conflict_action,
      });
      setImportState(s => s ? { ...s, phase: "done", result } : null);
      const updatedWorks = await listWorks();
      setWorks(updatedWorks);
    } catch (err) {
      setImportState(s => s ? { ...s, phase: "error", error: String(err) } : null);
    }
  };

  const maintTypeLabel = (type: MaintProgress["type"]) => {
    if (type === "analyze") return str.debug_analyze_btn;
    if (type === "embed")   return str.debug_embed_btn;
    if (type === "persona") return str.debug_persona_btn;
    if (type === "enrich_events") return str.debug_enrich_events_btn;
    return str.debug_resolve_btn;
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold">{str.debug_title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Import section ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.debug_import_section}</h3>
          <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />

          {!importState ? (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => importFileRef.current?.click()}>
              {str.debug_import_btn}
            </Button>
          ) : importState.phase === "confirm" && importState.parsed ? (
            <div className="space-y-3 text-xs border border-gray-200 rounded p-3">
              <div>
                <p className="font-semibold text-sm">{importState.parsed.manifest.work.title}</p>
                <p className="text-gray-500">{importState.parsed.manifest.work.author}</p>
                {(importState.parsed.manifest.creator || importState.parsed.manifest.label) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-indigo-600">
                    {importState.parsed.manifest.creator && <span>{str.debug_creator_label}: {importState.parsed.manifest.creator}</span>}
                    {importState.parsed.manifest.label && <span>{str.debug_label_field}: {importState.parsed.manifest.label}</span>}
                  </div>
                )}
                <p className="text-gray-500 mt-1">
                  {str.debug_import_result(
                    importState.parsed.manifest.chapters.length,
                    importState.parsed.manifest.entities.length
                  )} ·{" "}
                  {importState.parsed.manifest.includes_text ? str.debug_has_text : str.debug_no_text} ·{" "}
                  {importState.parsed.manifest.embedding_model
                    ? str.debug_embed_model(importState.parsed.manifest.embedding_model)
                    : "Embeddingなし"}
                </p>
              </div>
              {!importState.parsed.embedding_compatible && (
                <p className="text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                  ⚠ {importState.parsed.embedding_mismatch_reason}<br />
                  {str.debug_embed_compat_warn}
                </p>
              )}
              {importState.parsed.existing_work && (
                <div>
                  <p className="text-amber-700 mb-1">⚠ {str.debug_duplicate_warn}</p>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="conflict"
                        checked={importState.conflict_action === "overwrite"}
                        onChange={() => setImportState(s => s ? { ...s, conflict_action: "overwrite" } : null)}
                      />
                      {str.debug_overwrite}
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="conflict"
                        checked={importState.conflict_action === "create_new"}
                        onChange={() => setImportState(s => s ? { ...s, conflict_action: "create_new" } : null)}
                      />
                      {str.debug_create_new}
                    </label>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleImportConfirm}>
                  {str.debug_import_execute}
                </Button>
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setImportState(null)}>
                  {str.debug_import_cancel}
                </Button>
              </div>
            </div>
          ) : importState.phase === "importing" ? (
            <p className="text-xs text-indigo-600 px-2 py-2">{str.debug_importing}</p>
          ) : importState.phase === "done" && importState.result ? (
            <div className="text-xs border border-green-200 bg-green-50 rounded p-3 space-y-1">
              <p className="text-green-700 font-medium">{str.debug_import_done_title}</p>
              <p className="text-green-600">
                {str.debug_import_result(importState.result.chapters_imported, importState.result.entities_imported)}
                {importState.result.embeddings_dropped ? str.debug_embed_dropped : ""}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setImportState(null)}>{str.debug_close}</Button>
            </div>
          ) : importState.phase === "error" ? (
            <div className="text-xs border border-red-200 bg-red-50 rounded p-3 space-y-2">
              <p className="text-red-700">{importState.error}</p>
              <Button variant="ghost" size="sm" onClick={() => setImportState(null)}>{str.debug_close}</Button>
            </div>
          ) : null}
        </section>

        {/* ── Work selector ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.debug_works_section}</h3>
          {works.length === 0 ? (
            <p className="text-xs text-gray-400">{str.debug_no_works}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {works.map(w => (
                <button
                  key={w.id}
                  onClick={() => setSelectedWork(w)}
                  className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                    selectedWork?.id === w.id
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                      : "border-gray-200 hover:border-gray-300 text-gray-700"
                  }`}
                >
                  {w.title}
                </button>
              ))}
            </div>
          )}
        </section>

        {selectedWork && (
          <>
            {/* ── Maintenance ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.debug_maint_section}</h3>
              {maint ? (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>
                        {maintTypeLabel(maint.type)}
                        {" "}{maint.done} / {maint.total > 0 ? maint.total : "…"}
                      </span>
                      {maint.total > 0 && <span>{Math.round((maint.done / maint.total) * 100)}%</span>}
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full transition-all"
                        style={{ width: maint.total > 0 ? `${(maint.done / maint.total) * 100}%` : "0%" }}
                      />
                    </div>
                  </div>
                  {maint.current && (
                    <p className="text-xs text-indigo-600 truncate">
                      {str.debug_processing} {maint.current}
                      {maint.blockInfo && <span className="ml-1 text-indigo-400">({maint.blockInfo})</span>}
                    </p>
                  )}
                  {maint.errors.length > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 max-h-20 overflow-y-auto space-y-0.5">
                      {maint.errors.map((e, i) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                  {maint.finished && (
                    <>
                      {maint.type === "resolve" && (
                        <p className="text-xs text-green-700">
                          {str.debug_resolve_done(maint.mergeCount ?? 0)}
                        </p>
                      )}
                      {maint.type === "persona" && (
                        <p className="text-xs text-green-700">
                          {str.debug_persona_done(maint.mergeCount ?? 0)}
                        </p>
                      )}
                      {maint.type === "enrich_events" && (
                        <p className="text-xs text-green-700">
                          {str.debug_enrich_events_done(maint.mergeCount ?? 0)}
                        </p>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setMaint(null)}>{str.debug_close}</Button>
                    </>
                  )}
                  {!maint.finished && (
                    <Button variant="ghost" size="sm" onClick={() => { abortRef.current = true; setMaint(null); }}>{str.debug_abort}</Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {embeddingStats && (
                    <div className={`px-2 py-1.5 rounded text-xs ${
                      !embeddingStats.model
                        ? "bg-red-50 text-red-700"
                        : embeddingStats.embedded_chunks === 0
                          ? "bg-amber-50 text-amber-700"
                          : embeddingStats.embedded_chunks < embeddingStats.total_chunks
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-green-50 text-green-700"
                    }`}>
                      {!embeddingStats.model
                        ? "⚠ Embeddingモデル未設定 — 設定画面でAPIキーとモデル名を入力してください"
                        : embeddingStats.embedded_chunks === 0
                          ? `⚠ Embeddingなし — 「全章をEmbedding」を実行してください（${embeddingStats.model}）`
                          : embeddingStats.embedded_chunks < embeddingStats.total_chunks
                            ? `△ Embedding: ${embeddingStats.embedded_chunks} / ${embeddingStats.total_chunks} チャンク（${embeddingStats.model}）`
                            : `✓ Embedding完了: ${embeddingStats.embedded_chunks} / ${embeddingStats.total_chunks} チャンク（${embeddingStats.model}）`
                      }
                    </div>
                  )}
                  {embedTest.state !== "idle" && (
                    <div className={`px-2 py-1.5 rounded text-xs ${
                      embedTest.state === "ok"   ? "bg-green-50 text-green-700" :
                      embedTest.state === "fail" ? "bg-red-50 text-red-700" :
                                                   "bg-gray-50 text-gray-500"
                    }`}>
                      {embedTest.state === "testing" ? "Embedding接続確認中..." : embedTest.msg}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => runMaint("analyze")}>
                      {str.debug_analyze_btn}
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => runMaint("embed")}>
                      {str.debug_embed_btn}
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => runMaint("resolve")}>
                      {str.debug_resolve_btn}
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => runMaint("persona")}>
                      {str.debug_persona_btn}
                    </Button>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => runMaint("enrich_events")}>
                      {str.debug_enrich_events_btn}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* ── Export ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.debug_export_section}</h3>
              {!exportState ? (
                <Button variant="ghost" size="sm" className="w-full"
                  onClick={() => setExportState({ include_text: false, include_embeddings: true, exporting: false })}>
                  {str.debug_export_btn}
                </Button>
              ) : (
                <div className="space-y-3 text-xs border border-gray-200 rounded p-3">
                  {embeddingStats && (
                    <div className={`px-2 py-1.5 rounded text-xs ${
                      !embeddingStats.model || embeddingStats.embedded_chunks === 0
                        ? "bg-amber-50 text-amber-700"
                        : "bg-green-50 text-green-700"
                    }`}>
                      {!embeddingStats.model
                        ? "⚠ Embeddingモデル未設定 — 設定画面でAPIキーとモデル名を入力してください"
                        : embeddingStats.embedded_chunks === 0
                          ? "⚠ Embeddingなし — エクスポート前に「全章をEmbedding」を実行してください"
                          : `✓ Embedding済: ${embeddingStats.embedded_chunks} / ${embeddingStats.total_chunks} チャンク（${embeddingStats.model}）`
                      }
                    </div>
                  )}
                  <div>
                    <label className="block text-gray-500 mb-1">{str.debug_creator_label}</label>
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder={str.debug_creator_ph}
                      value={exportCreator}
                      onChange={e => setExportCreator(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">{str.debug_label_field}</label>
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder={str.debug_label_ph}
                      value={exportLabel}
                      onChange={e => setExportLabel(e.target.value)}
                    />
                  </div>
                  <p className="text-gray-400 text-xs">{str.debug_creator_note}</p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={exportState.include_text}
                      onChange={e => setExportState(s => s ? { ...s, include_text: e.target.checked } : null)}
                    />
                    <span>
                      <span className="font-medium">{str.debug_include_text}</span>
                      <span className="text-amber-600 ml-1">{str.debug_include_text_warn}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={exportState.include_embeddings}
                      onChange={e => setExportState(s => s ? { ...s, include_embeddings: e.target.checked } : null)}
                    />
                    <span>
                      <span className="font-medium">{str.debug_include_embed}</span>
                      <span className="text-gray-500 ml-1">{str.debug_include_embed_note}</span>
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={exportState.exporting} onClick={handleExport}>
                      {exportState.exporting ? str.debug_generating : str.debug_download}
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setExportState(null)}>
                      {str.debug_export_cancel}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* ── Chat Debug Log ── */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">{str.debug_chat_section}</h3>
                {chatDebugSessions.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleClearChatDebug}>
                    {chatDebugCleared ? str.debug_chat_cleared : str.debug_chat_clear}
                  </Button>
                )}
              </div>
              {chatDebugSessions.length === 0 ? (
                <p className="text-xs text-gray-400">{str.debug_chat_no_logs}</p>
              ) : (
                <ul className="space-y-2">
                  {chatDebugSessions.map(session => {
                    const charName = characterName(session.character_id);
                    const ts = new Date(session.last_active).toLocaleString();
                    return (
                      <li key={session.id} className="border border-gray-200 rounded overflow-hidden text-xs">
                        <button
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50"
                          onClick={() => setExpandedDebugSession(v => v === session.id ? null : session.id)}
                        >
                          <span className="font-medium truncate">{str.debug_chat_session_label(charName, ts)}</span>
                          <span className="ml-2 shrink-0">{expandedDebugSession === session.id ? "▲" : "▼"}</span>
                        </button>
                        {expandedDebugSession === session.id && (
                          <div className="border-t border-gray-100 divide-y divide-gray-100 max-h-96 overflow-y-auto">
                            {session.tier_0_recent_turns.map((turn, i) => (
                              <div key={i} className="px-3 py-2">
                                <p className="font-medium text-gray-600 mb-0.5">
                                  {turn.role === "user" ? str.debug_chat_user : str.debug_chat_char}
                                </p>
                                <p className="text-gray-700 whitespace-pre-wrap break-words line-clamp-2">
                                  {turn.content}
                                </p>
                                {turn.debug_prompt && (
                                  <details className="mt-1">
                                    <summary className="text-indigo-500 cursor-pointer select-none">
                                      {str.debug_chat_prompt_label}
                                    </summary>
                                    <pre className="mt-1 text-gray-500 whitespace-pre-wrap break-words bg-gray-50 p-2 rounded max-h-64 overflow-y-auto leading-relaxed">
                                      {turn.debug_prompt}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ── Characters ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                {str.debug_chars_section(characters.filter(c => c.type === "character").length)}
              </h3>
              {characters.filter(c => c.type === "character").length === 0 ? (
                <p className="text-xs text-gray-400">{str.debug_no_chars}</p>
              ) : (
                <ul className="space-y-1.5">
                  {characters.filter(c => c.type === "character").map(c => (
                    <li key={c.id} className="border border-gray-200 rounded p-2 text-xs">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{c.canonical_name}</span>
                        <span className="ml-auto text-gray-400 shrink-0">{str.debug_first_appear(c.first_appearance ?? "?")}</span>
                      </div>
                      {c.aliases.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.aliases.map(a => (
                            <span key={a} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                              {a}
                              <button
                                className="ml-0.5 text-gray-400 hover:text-red-500 leading-none"
                                onClick={() => handleRemoveAlias(c.id, a)}
                              >×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      {c.description && (
                        <p className="text-gray-600 mt-1 leading-relaxed">{c.description}</p>
                      )}
                      {c.key_appearances.length > 0 && (
                        <p className="text-gray-400 mt-1">
                          {str.debug_appear_chapters(c.key_appearances.map(n => str.snap_from_chapter(n)).join(", "))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Chapters ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                {str.debug_chapters_section(chapters.length)}
              </h3>
              {chapters.length === 0 ? (
                <p className="text-xs text-gray-400">{str.debug_no_chapters}</p>
              ) : (
                <ul className="space-y-2">
                  {chapters.map(ch => (
                    <li key={ch.id} className="border border-gray-200 rounded text-xs">
                      <button
                        className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50"
                        onClick={() => setExpandedChapter(expandedChapter === ch.id ? null : ch.id)}
                      >
                        <span>
                          <span className="font-semibold">第{ch.chapter_number}章</span>
                          {ch.title && <span className="ml-2 text-gray-600">「{ch.title}」</span>}
                        </span>
                        <span className="text-gray-400 ml-2 shrink-0">
                          {expandedChapter === ch.id ? "▲" : "▼"}
                        </span>
                      </button>

                      {expandedChapter === ch.id && (
                        <div className="px-3 pb-3 space-y-2 border-t border-gray-100">
                          {ch.summary_ultra && (
                            <div>
                              <p className="text-gray-400 mt-2 mb-0.5 font-medium">{str.debug_ultra_summary}</p>
                              <p className="text-gray-700">{ch.summary_ultra}</p>
                            </div>
                          )}
                          {ch.summary_short && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">{str.debug_short_summary}</p>
                              <p className="text-gray-700 leading-relaxed">{ch.summary_short}</p>
                            </div>
                          )}
                          {ch.summary_medium && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">{str.debug_medium_summary}</p>
                              <p className="text-gray-700 leading-relaxed">{ch.summary_medium}</p>
                            </div>
                          )}
                          {ch.key_events.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">{str.debug_key_events}</p>
                              <ul className="space-y-0.5">
                                {ch.key_events.map((e, i) => (
                                  <li key={i} className="text-gray-700">・{e}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {ch.appearing_characters.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">{str.debug_appearing_chars}</p>
                              <p className="text-gray-700">
                                {ch.appearing_characters.map(characterName).join(", ")}
                              </p>
                            </div>
                          )}
                          {ch.mentioned_items.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">{str.debug_items}</p>
                              <p className="text-gray-700">{ch.mentioned_items.join(", ")}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-400 mb-0.5 font-medium">{str.debug_text_label}</p>
                            <p className="text-gray-400">
                              {str.debug_text_stats(ch.full_text.length.toLocaleString(), ch.chunk_ids.length)}
                            </p>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

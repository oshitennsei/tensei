import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { listWorks, listChapters, reanalyzeWork, reembedWork, resolveEntities, generateMissingPersonas } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Chapter, Entity } from "@/lib/storage";
import { exportWork, downloadManifest, getEmbeddingStats } from "@/lib/storage/export";
import type { EmbeddingStats } from "@/lib/storage/export";
import { parseExportFile, analyzeImport, importWork } from "@/lib/storage/import";
import type { ParsedImport, ConflictAction, ImportResult } from "@/lib/storage/import";
import { getEmbedder } from "@/lib/embedding";

interface MaintProgress {
  type: "analyze" | "embed" | "resolve" | "persona";
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
}

export function DebugScreen({ onBack }: Props) {
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
  const abortRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listWorks().then(setWorks); }, []);

  useEffect(() => {
    if (!selectedWork) { setChapters([]); setCharacters([]); setEmbeddingStats(null); return; }
    setEmbeddingStats(null);
    Promise.all([
      listChapters(selectedWork.id),
      db.entities.where("work_id").equals(selectedWork.id).toArray(),
      getEmbeddingStats(selectedWork.id),
    ]).then(([chs, ents, stats]) => {
      setChapters(chs);
      setCharacters(ents);
      setEmbeddingStats(stats);
      setExpandedChapter(null);
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

  // ── Maintenance ──────────────────────────────────────────────────────────────

  const runMaint = async (type: "analyze" | "embed" | "resolve" | "persona") => {
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
      // Quick connection test before running full embed
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

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold">解析データ</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Import section ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">インポート</h3>
          <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />

          {!importState ? (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => importFileRef.current?.click()}>
              解析データをインポート (.json)
            </Button>
          ) : importState.phase === "confirm" && importState.parsed ? (
            <div className="space-y-3 text-xs border border-gray-200 rounded p-3">
              <div>
                <p className="font-semibold text-sm">{importState.parsed.manifest.work.title}</p>
                <p className="text-gray-500">{importState.parsed.manifest.work.author}</p>
                {(importState.parsed.manifest.creator || importState.parsed.manifest.label) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-indigo-600">
                    {importState.parsed.manifest.creator && <span>作成者: {importState.parsed.manifest.creator}</span>}
                    {importState.parsed.manifest.label && <span>ラベル: {importState.parsed.manifest.label}</span>}
                  </div>
                )}
                <p className="text-gray-500 mt-1">
                  {importState.parsed.manifest.chapters.length}章 ·{" "}
                  {importState.parsed.manifest.entities.length}キャラクター ·{" "}
                  {importState.parsed.manifest.includes_text ? "原文あり" : "原文なし"} ·{" "}
                  {importState.parsed.manifest.embedding_model
                    ? `Embedding: ${importState.parsed.manifest.embedding_model}`
                    : "Embeddingなし"}
                </p>
              </div>
              {!importState.parsed.embedding_compatible && (
                <p className="text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                  ⚠ {importState.parsed.embedding_mismatch_reason}<br />
                  Embeddingデータは削除されます。インポート後に再計算が必要です。
                </p>
              )}
              {importState.parsed.existing_work && (
                <div>
                  <p className="text-amber-700 mb-1">⚠ 同名の作品が既に存在します。</p>
                  <div className="flex gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="conflict"
                        checked={importState.conflict_action === "overwrite"}
                        onChange={() => setImportState(s => s ? { ...s, conflict_action: "overwrite" } : null)}
                      />
                      上書き（既存データを削除）
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="conflict"
                        checked={importState.conflict_action === "create_new"}
                        onChange={() => setImportState(s => s ? { ...s, conflict_action: "create_new" } : null)}
                      />
                      新規作成
                    </label>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleImportConfirm}>
                  インポート実行
                </Button>
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setImportState(null)}>
                  キャンセル
                </Button>
              </div>
            </div>
          ) : importState.phase === "importing" ? (
            <p className="text-xs text-indigo-600 px-2 py-2">インポート中...</p>
          ) : importState.phase === "done" && importState.result ? (
            <div className="text-xs border border-green-200 bg-green-50 rounded p-3 space-y-1">
              <p className="text-green-700 font-medium">インポート完了</p>
              <p className="text-green-600">
                {importState.result.chapters_imported}章 · {importState.result.entities_imported}キャラクター
                {importState.result.embeddings_dropped ? " · Embedding削除済（要再計算）" : ""}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setImportState(null)}>閉じる</Button>
            </div>
          ) : importState.phase === "error" ? (
            <div className="text-xs border border-red-200 bg-red-50 rounded p-3 space-y-2">
              <p className="text-red-700">{importState.error}</p>
              <Button variant="ghost" size="sm" onClick={() => setImportState(null)}>閉じる</Button>
            </div>
          ) : null}
        </section>

        {/* ── Work selector ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">作品</h3>
          {works.length === 0 ? (
            <p className="text-xs text-gray-400">作品がありません。</p>
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
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">メンテナンス</h3>
              {maint ? (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>
                        {maint.type === "analyze" ? "再解析" : maint.type === "embed" ? "Embedding"
                          : maint.type === "persona" ? "ペルソナ生成" : "人物同定"}
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
                      処理中: {maint.current}
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
                          {maint.mergeCount ? `${maint.mergeCount} 件のキャラクターを統合しました。` : "重複キャラクターは見つかりませんでした。"}
                        </p>
                      )}
                      {maint.type === "persona" && (
                        <p className="text-xs text-green-700">
                          {maint.mergeCount ? `${maint.mergeCount} 件のペルソナを生成しました。` : "生成対象がありませんでした。"}
                        </p>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setMaint(null)}>閉じる</Button>
                    </>
                  )}
                  {!maint.finished && (
                    <Button variant="ghost" size="sm" onClick={() => { abortRef.current = true; setMaint(null); }}>中断</Button>
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
                    embedTest.state === "ok"      ? "bg-green-50 text-green-700" :
                    embedTest.state === "fail"    ? "bg-red-50 text-red-700" :
                                                    "bg-gray-50 text-gray-500"
                  }`}>
                    {embedTest.state === "testing" ? "Embedding接続確認中..." : embedTest.msg}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => runMaint("analyze")}>
                    全章を再解析
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => runMaint("embed")}>
                    全章をEmbedding
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => runMaint("resolve")}>
                    人物同定（重複キャラを統合）
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => runMaint("persona")}>
                    空ペルソナを自動生成
                  </Button>
                </div>
                </div>
              )}
            </section>

            {/* ── Export ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">エクスポート</h3>
              {!exportState ? (
                <Button variant="ghost" size="sm" className="w-full"
                  onClick={() => setExportState({ include_text: false, include_embeddings: true, exporting: false })}>
                  この作品をエクスポート
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
                    <label className="block text-gray-500 mb-1">作成者（任意）</label>
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="名前・ハンドルネーム"
                      value={exportCreator}
                      onChange={e => setExportCreator(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">ラベル（任意）</label>
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="例: GPT-4o完全解析版 v2"
                      value={exportLabel}
                      onChange={e => setExportLabel(e.target.value)}
                    />
                  </div>
                  <p className="text-gray-400 text-xs">入力した情報はファイルに含まれ、インポートした人に見えます。</p>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={exportState.include_text}
                      onChange={e => setExportState(s => s ? { ...s, include_text: e.target.checked } : null)}
                    />
                    <span>
                      <span className="font-medium">原文を含める</span>
                      <span className="text-amber-600 ml-1">（著作権に注意）</span>
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
                      <span className="font-medium">Embeddingを含める</span>
                      <span className="text-gray-500 ml-1">（インポート先で同じモデルが必要）</span>
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={exportState.exporting} onClick={handleExport}>
                      {exportState.exporting ? "生成中..." : "ダウンロード"}
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => setExportState(null)}>
                      キャンセル
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* ── Characters ── */}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                キャラクター ({characters.filter(c => c.type === "character").length}人)
              </h3>
              {characters.filter(c => c.type === "character").length === 0 ? (
                <p className="text-xs text-gray-400">キャラクターなし</p>
              ) : (
                <ul className="space-y-1.5">
                  {characters.filter(c => c.type === "character").map(c => (
                    <li key={c.id} className="border border-gray-200 rounded p-2 text-xs">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{c.canonical_name}</span>
                        <span className="ml-auto text-gray-400 shrink-0">初登場: 第{c.first_appearance ?? "?"}章</span>
                      </div>
                      {c.aliases.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.aliases.map(a => (
                            <span key={a} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                              {a}
                              <button
                                className="ml-0.5 text-gray-400 hover:text-red-500 leading-none"
                                title="削除"
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
                          登場章: {c.key_appearances.map(n => `第${n}章`).join(", ")}
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
                チャプター ({chapters.length}章)
              </h3>
              {chapters.length === 0 ? (
                <p className="text-xs text-gray-400">チャプターなし</p>
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
                              <p className="text-gray-400 mt-2 mb-0.5 font-medium">超短要約</p>
                              <p className="text-gray-700">{ch.summary_ultra}</p>
                            </div>
                          )}
                          {ch.summary_short && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">短要約</p>
                              <p className="text-gray-700 leading-relaxed">{ch.summary_short}</p>
                            </div>
                          )}
                          {ch.summary_medium && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">中要約</p>
                              <p className="text-gray-700 leading-relaxed">{ch.summary_medium}</p>
                            </div>
                          )}
                          {ch.key_events.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">主要イベント</p>
                              <ul className="space-y-0.5">
                                {ch.key_events.map((e, i) => (
                                  <li key={i} className="text-gray-700">・{e}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {ch.appearing_characters.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">登場キャラクター</p>
                              <p className="text-gray-700">
                                {ch.appearing_characters.map(characterName).join(", ")}
                              </p>
                            </div>
                          )}
                          {ch.mentioned_items.length > 0 && (
                            <div>
                              <p className="text-gray-400 mb-0.5 font-medium">アイテム</p>
                              <p className="text-gray-700">{ch.mentioned_items.join(", ")}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-400 mb-0.5 font-medium">本文</p>
                            <p className="text-gray-400">
                              {ch.full_text.length.toLocaleString()} 文字 / {ch.chunk_ids.length} チャンク
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

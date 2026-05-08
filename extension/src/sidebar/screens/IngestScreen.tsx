import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { getOrCreateWork, ingestPastedText, listWorks, listChapters } from "@/lib/ingestion";
import type { AnalysisStatus } from "@/lib/ingestion";
import type { Work } from "@/lib/storage";

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  idle:      "",
  chunking:  "テキストを分割中...",
  analyzing: "LLMで解析中...",
  saving:    "データを保存中...",
  embedding: "Embedding計算中...",
  done:      "完了",
  no_llm:    "LLM未設定のためスキップ",
  error:     "解析中にエラーが発生しました",
};

const CHINESE_NUMS: Record<string, number> = {
  '〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
  '十':10,'十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,
  '二十':20,'二十一':21,'二十二':22,'二十三':23,'二十四':24,'二十五':25,'二十六':26,
};

interface ParsedFile {
  file: File;
  part: number;
  chapterInPart: number; // 999 = epilogue
  title: string;
  globalChapter: number; // assigned after sort
}

function parseNovelFilename(file: File): Omit<ParsedFile, 'file' | 'globalChapter'> | null {
  const name = file.name.replace(/\.(md|txt)$/i, '');
  // 第{CN}部_第{nn}章_{title}
  const m = name.match(/^第([一二三四五六七八九十]+)部_第(\d+)章_(.+)$/);
  if (m) {
    return { part: CHINESE_NUMS[m[1]] ?? 0, chapterInPart: parseInt(m[2]), title: m[3] };
  }
  // 第{CN}部_尾聲_{title}
  const e = name.match(/^第([一二三四五六七八九十]+)部_尾聲_(.+)$/);
  if (e) {
    return { part: CHINESE_NUMS[e[1]] ?? 0, chapterInPart: 999, title: `尾聲: ${e[2]}` };
  }
  // Fallback: no part structure detected — treat as single unordered file
  return { part: 0, chapterInPart: 0, title: name };
}

function prepareFiles(files: File[], nextChapter: number): ParsedFile[] {
  const parsed: ParsedFile[] = [];
  for (const file of files) {
    const info = parseNovelFilename(file);
    if (!info) continue;
    parsed.push({ file, ...info, globalChapter: 0 });
  }
  parsed.sort((a, b) => a.part - b.part || a.chapterInPart - b.chapterInPart || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
  parsed.forEach((p, i) => { p.globalChapter = nextChapter + i; });
  return parsed;
}

interface Props {
  onBack: () => void;
  onDone: (work: Work, chapter_number: number) => void;
}

type Step = "pick" | "new-work" | "mode" | "chapter" | "batch-select" | "batch-run";

export function IngestScreen({ onBack, onDone }: Props) {
  const [step, setStep] = useState<Step>("pick");
  const [works, setWorks] = useState<Work[]>([]);
  const [work, setWork] = useState<Work | null>(null);
  const [nextChapter, setNextChapter] = useState(1);
  const [workForm, setWorkForm] = useState({
    title: "", author: "",
    language: "zh-tw" as Work["language"],
    platform: "other" as Work["platform"],
  });
  const [chapterForm, setChapterForm] = useState({ chapter_number: 1, title: "", full_text: "" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [error, setError] = useState("");

  // Batch state
  const [batchFiles, setBatchFiles] = useState<ParsedFile[]>([]);
  const [batchDone, setBatchDone] = useState(0);
  const [batchCurrent, setBatchCurrent] = useState("");
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => { listWorks().then(setWorks); }, []);

  const selectWork = async (w: Work) => {
    setWork(w);
    setError("");
    const chapters = await listChapters(w.id);
    const next = chapters.length > 0 ? Math.max(...chapters.map(c => c.chapter_number)) + 1 : 1;
    setNextChapter(next);
    setChapterForm(f => ({ ...f, chapter_number: next, title: "", full_text: "" }));
    setStep("mode");
  };

  const handleNewWork = async () => {
    if (!workForm.title || !workForm.author) { setError("タイトルと作者を入力してください。"); return; }
    setBusy(true); setError("");
    try {
      const w = await getOrCreateWork({ ...workForm, source_type: "pasted" });
      await selectWork(w);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const handleIngest = async () => {
    if (!work || !chapterForm.full_text.trim()) { setError("本文を貼り付けてください。"); return; }
    setBusy(true); setError(""); setStatus("idle");
    try {
      await ingestPastedText(work.id, chapterForm.chapter_number, chapterForm.title || `第${chapterForm.chapter_number}章`, chapterForm.full_text, setStatus, setError);
      onDone(work, chapterForm.chapter_number);
    } catch (e) { setError(String(e)); setStatus("error"); } finally { setBusy(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBatchFiles(prepareFiles(files, nextChapter));
    setStep("batch-select");
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setBatchFiles(prev => {
      const next = [...prev];
      const swap = idx + dir;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      next.forEach((p, i) => { p.globalChapter = nextChapter + i; });
      return next;
    });
  };

  const handleDragStart = (idx: number) => { dragIndexRef.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(null);
    const from = dragIndexRef.current;
    if (from === null || from === idx) return;
    setBatchFiles(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      next.forEach((p, i) => { p.globalChapter = nextChapter + i; });
      return next;
    });
    dragIndexRef.current = null;
  };
  const handleDragEnd = () => { setDragOver(null); dragIndexRef.current = null; };

  const handleBatchStart = async () => {
    if (!work || batchFiles.length === 0) return;
    abortRef.current = false;
    setBatchDone(0);
    setBatchErrors([]);
    setStep("batch-run");

    for (let i = 0; i < batchFiles.length; i++) {
      if (abortRef.current) break;
      const pf = batchFiles[i];
      setBatchCurrent(`第${pf.globalChapter}章「${pf.title}」`);
      try {
        const text = await pf.file.text();
        const errs: string[] = [];
        await ingestPastedText(
          work.id,
          pf.globalChapter,
          pf.title,
          text,
          () => {},
          (msg) => errs.push(`第${pf.globalChapter}章: ${msg}`),
        );
        if (errs.length > 0) setBatchErrors(prev => [...prev, ...errs]);
      } catch (err) {
        setBatchErrors(prev => [...prev, `第${pf.globalChapter}章: ${String(err)}`]);
      }
      setBatchDone(i + 1);
    }
    setBatchCurrent("");
  };

  const goBack = () => {
    if (step === "chapter" || step === "mode" || step === "batch-select") {
      setStep("pick"); setWork(null); setError("");
    } else if (step === "new-work") {
      setStep("pick"); setError("");
    } else if (step === "batch-run") {
      abortRef.current = true; setStep("mode");
    } else {
      onBack();
    }
  };

  const batchFinished = step === "batch-run" && !batchCurrent && batchDone === batchFiles.length && batchDone > 0;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={goBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold">テキストを取り込む</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Step: pick ─────────────────────────────────────── */}
        {step === "pick" && (
          <>
            {works.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">既存の作品に追加</h3>
                <ul className="space-y-1.5">
                  {works.map(w => (
                    <li key={w.id}>
                      <button
                        onClick={() => selectWork(w)}
                        className="w-full text-left px-3 py-2 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-sm transition-colors"
                      >
                        <span className="font-medium">{w.title}</span>
                        <span className="ml-2 text-xs text-gray-400">{w.author}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">新しい作品を作成</h3>
              <Button className="w-full" onClick={() => { setStep("new-work"); setError(""); }}>
                + 新しい作品
              </Button>
            </section>
          </>
        )}

        {/* ── Step: new-work ─────────────────────────────────── */}
        {step === "new-work" && (
          <>
            <p className="text-xs text-gray-500">新しい作品の情報を入力してください。</p>
            <div>
              <label className="block text-xs text-gray-600 mb-1">タイトル</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.title} onChange={e => setWorkForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">作者</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.author} onChange={e => setWorkForm(f => ({ ...f, author: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">言語</label>
              <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.language} onChange={e => setWorkForm(f => ({ ...f, language: e.target.value as Work["language"] }))}>
                <option value="ja">日本語</option>
                <option value="zh-tw">繁體中文</option>
                <option value="zh-cn">简体中文</option>
                <option value="zh">中文（自動）</option>
                <option value="en">English</option>
                <option value="ko">한국어</option>
                <option value="other">その他</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">プラットフォーム</label>
              <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.platform} onChange={e => setWorkForm(f => ({ ...f, platform: e.target.value as Work["platform"] }))}>
                <option value="syosetu">小説家になろう</option>
                <option value="kakuyomu">カクヨム</option>
                <option value="other">その他</option>
              </select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleNewWork} disabled={busy} className="w-full">次へ</Button>
          </>
        )}

        {/* ── Step: mode ─────────────────────────────────────── */}
        {step === "mode" && work && (
          <>
            <p className="text-xs text-gray-500 font-medium">「{work.title}」— 取込方法を選択</p>
            <div className="space-y-2">
              <button
                onClick={() => setStep("batch-select")}
                className="w-full text-left px-4 py-3 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
              >
                <p className="text-sm font-medium">ファイルから一括取込</p>
                <p className="text-xs text-gray-400 mt-0.5">.md / .txt ファイルを複数選択。ファイル名から章番号と順序を自動解析します。</p>
              </button>
              <button
                onClick={() => setStep("chapter")}
                className="w-full text-left px-4 py-3 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
              >
                <p className="text-sm font-medium">1章ずつ貼り付け</p>
                <p className="text-xs text-gray-400 mt-0.5">本文をテキストエリアに貼り付けて1章ずつ取り込みます。</p>
              </button>
            </div>
            {/* Hidden file input triggered by batch button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </>
        )}

        {/* ── Step: chapter (single paste) ───────────────────── */}
        {step === "chapter" && work && (
          <>
            <p className="text-xs text-gray-500 font-medium">「{work.title}」にチャプターを追加</p>
            <div className="flex gap-2">
              <div className="w-24">
                <label className="block text-xs text-gray-600 mb-1">章番号</label>
                <input type="number" min={1} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={chapterForm.chapter_number} onChange={e => setChapterForm(f => ({ ...f, chapter_number: Number(e.target.value) }))} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-600 mb-1">章タイトル (任意)</label>
                <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={chapterForm.title} onChange={e => setChapterForm(f => ({ ...f, title: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">本文を貼り付け</label>
              <textarea
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                rows={12}
                placeholder="ここに本文を貼り付けてください..."
                value={chapterForm.full_text}
                onChange={e => setChapterForm(f => ({ ...f, full_text: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">{chapterForm.full_text.length.toLocaleString()} 文字</p>
            </div>
            {status !== "idle" && (
              <p className={`text-xs ${status === "error" ? "text-red-600" : status === "done" ? "text-green-600" : "text-indigo-600"}`}>
                {STATUS_LABELS[status]}
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleIngest} disabled={busy || !chapterForm.full_text.trim()} className="w-full">
              {busy ? STATUS_LABELS[status] || "処理中..." : "取り込む"}
            </Button>
          </>
        )}

        {/* ── Step: batch-select ─────────────────────────────── */}
        {step === "batch-select" && work && (
          <>
            <p className="text-xs text-gray-500 font-medium">「{work.title}」— ファイルを選択</p>
            {batchFiles.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  .md または .txt ファイルを複数選択してください。<br />
                  ファイル名の形式: <code className="bg-gray-100 px-1 rounded">第一部_第01章_タイトル.md</code>
                </p>
                <Button
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ファイルを選択...
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">{batchFiles.length} 件のファイル — 通し番号 {batchFiles[0].globalChapter}〜{batchFiles[batchFiles.length - 1].globalChapter}章</p>
                  <button className="text-xs text-indigo-600 underline" onClick={() => { setBatchFiles([]); fileInputRef.current?.click(); }}>
                    選び直す
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".md,.txt" multiple className="hidden" onChange={handleFileSelect} />
                <ul className="text-xs text-gray-600 space-y-0.5 max-h-64 overflow-y-auto border border-gray-100 rounded p-2">
                  {batchFiles.map((pf, idx) => (
                    <li
                      key={pf.file.name}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={e => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-1 py-0.5 rounded cursor-grab active:cursor-grabbing transition-colors ${
                        dragOver === idx ? "bg-indigo-50 border border-indigo-300" : "border border-transparent"
                      }`}
                    >
                      <span className="text-gray-300 px-1 select-none">⠿</span>
                      <span className="text-gray-400 w-8 shrink-0 font-mono">#{pf.globalChapter}</span>
                      <span className="flex-1 truncate">{pf.title || pf.file.name}</span>
                      <div className="flex shrink-0">
                        <button
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-default"
                          disabled={idx === 0}
                          onClick={() => moveFile(idx, -1)}
                          title="上へ"
                        >↑</button>
                        <button
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-default"
                          disabled={idx === batchFiles.length - 1}
                          onClick={() => moveFile(idx, 1)}
                          title="下へ"
                        >↓</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button className="w-full" onClick={handleBatchStart}>
                  取込開始 ({batchFiles.length} 章)
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Step: batch-run ────────────────────────────────── */}
        {step === "batch-run" && (
          <>
            <p className="text-xs text-gray-500 font-medium">「{work?.title}」取込中...</p>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{batchDone} / {batchFiles.length} 章</span>
                <span>{Math.round((batchDone / batchFiles.length) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(batchDone / batchFiles.length) * 100}%` }}
                />
              </div>
            </div>

            {batchCurrent && (
              <p className="text-xs text-indigo-600 truncate">解析中: {batchCurrent}</p>
            )}

            {batchErrors.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {batchErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {batchFinished && (
              <div className="space-y-2">
                <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
                  ✓ {batchDone} 章の取込が完了しました。{batchErrors.length > 0 && `（${batchErrors.length} 件のエラーあり）`}
                </p>
                <Button className="w-full" onClick={() => onDone(work!, batchFiles[batchFiles.length - 1].globalChapter)}>
                  完了
                </Button>
              </div>
            )}

            {!batchFinished && (
              <Button variant="ghost" className="w-full" onClick={() => { abortRef.current = true; }}>
                中断
              </Button>
            )}
          </>
        )}

      </div>
    </div>
  );
}

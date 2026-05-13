import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { getOrCreateWork, ingestPastedText, ingestKakuyomuWork, ingestSyosetsuWork, listWorks, listChapters } from "@/lib/ingestion";
import type { AnalysisStatus } from "@/lib/ingestion";
import type { Work } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";
import { parseKakuyomuWorkUrl, checkKakuyomuAuthorization } from "@/lib/platform/kakuyomu";
import type { KakuyomuPageInfo } from "@/lib/platform/kakuyomu";
import { parseSyosetsuWorkUrl, checkSyosetsuAuthorization, isSyosetsuChapterPage } from "@/lib/platform/syosetu";
import type { SyosetsuPageInfo } from "@/lib/platform/syosetu";

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
  const m = name.match(/^第([一二三四五六七八九十]+)部_第(\d+)章_(.+)$/);
  if (m) {
    return { part: CHINESE_NUMS[m[1]] ?? 0, chapterInPart: parseInt(m[2]), title: m[3] };
  }
  const e = name.match(/^第([一二三四五六七八九十]+)部_尾聲_(.+)$/);
  if (e) {
    return { part: CHINESE_NUMS[e[1]] ?? 0, chapterInPart: 999, title: `尾聲: ${e[2]}` };
  }
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
  onWorkRegister: (workUrl?: string) => void;
}

interface KkEpisodeItem {
  episode_id: string;
  title: string;
  order: number;
  checked: boolean;
}

interface SsChapterItem {
  chapter_num: number;
  title: string;
  order: number;
  checked: boolean;
}

type Step = "pick" | "new-work" | "mode" | "chapter" | "batch-select" | "batch-run"
  | "kakuyomu-check" | "kakuyomu-unauthorized" | "kakuyomu-select" | "kakuyomu-run"
  | "syosetu-check" | "syosetu-unauthorized" | "syosetu-select" | "syosetu-run";

export function IngestScreen({ onBack, onDone, onWorkRegister }: Props) {
  const str = useStrings();
  const [step, setStep] = useState<Step>("pick");
  const [works, setWorks] = useState<Work[]>([]);
  const [work, setWork] = useState<Work | null>(null);
  const [nextChapter, setNextChapter] = useState(1);
  const [workForm, setWorkForm] = useState({
    title: "", author: "",
    platform: "other" as Work["platform"],
  });
  const [chapterForm, setChapterForm] = useState({ chapter_number: 1, title: "", full_text: "" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [error, setError] = useState("");

  const [batchFiles, setBatchFiles] = useState<ParsedFile[]>([]);
  const [batchDone, setBatchDone] = useState(0);
  const [batchCurrent, setBatchCurrent] = useState("");
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);

  // Kakuyomu state
  const [kkPageInfo, setKkPageInfo] = useState<KakuyomuPageInfo | null>(null);
  const [kkEpisodes, setKkEpisodes] = useState<KkEpisodeItem[]>([]);
  const [kkWorkUrl, setKkWorkUrl] = useState("");
  const [kkAuthError, setKkAuthError] = useState<"not_registered" | "pending" | "network_error" | null>(null);
  const [kkIsEpisodePage, setKkIsEpisodePage] = useState(false);
  const [kkDone, setKkDone] = useState(0);
  const [kkErrors, setKkErrors] = useState<string[]>([]);
  const [kkCurrent, setKkCurrent] = useState("");
  const kkAbortRef = useRef(false);
  const kkTabIdRef = useRef<number | null>(null);

  // Syosetu state
  const [ssPageInfo, setSsPageInfo] = useState<SyosetsuPageInfo | null>(null);
  const [ssChapters, setSsChapters] = useState<SsChapterItem[]>([]);
  const [ssWorkUrl, setSsWorkUrl] = useState("");
  const [ssIsChapterPage, setSsIsChapterPage] = useState(false);
  const [ssDone, setSsDone] = useState(0);
  const [ssErrors, setSsErrors] = useState<string[]>([]);
  const [ssCurrent, setSsCurrent] = useState("");
  const ssAbortRef = useRef(false);
  const ssTabIdRef = useRef<number | null>(null);

  useEffect(() => { listWorks().then(setWorks); }, []);

  // Detect platform — extracted so it can be called on mount AND on tab navigation
  const detectPlatformRef = useRef<((url: string, tabId: number) => Promise<void>) | null>(null);
  detectPlatformRef.current = async (url: string, tabId: number) => {
    try {
    // ── Kakuyomu ────────────────────────────────────────────────
    const kkParsed = parseKakuyomuWorkUrl(url);
    if (kkParsed) {
      if (url.includes("/episodes/")) {
        setKkWorkUrl(kkParsed.canonical);
        setKkIsEpisodePage(true);
        setKkAuthError("not_registered");
        setStep("kakuyomu-unauthorized");
        return;
      }

      kkTabIdRef.current = tabId;
      setKkWorkUrl(kkParsed.canonical);
      setStep("kakuyomu-check");

      const authResult = await checkKakuyomuAuthorization(kkParsed.canonical);
      if (!authResult.authorized) {
        setKkAuthError(authResult.reason);
        setStep("kakuyomu-unauthorized");
        return;
      }

      let pageInfo: KakuyomuPageInfo | null = null;
      try {
        pageInfo = await chrome.tabs.sendMessage(tabId, { type: "KK_GET_PAGE_INFO" }) as KakuyomuPageInfo | null;
      } catch {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/index.js"] });
          await new Promise(r => setTimeout(r, 200));
          pageInfo = await chrome.tabs.sendMessage(tabId, { type: "KK_GET_PAGE_INFO" }) as KakuyomuPageInfo | null;
        } catch { pageInfo = null; }
      }

      if (!pageInfo || pageInfo.episodes.length === 0) { setStep("pick"); return; }

      const existingWorks = await listWorks();
      const matchedWork = existingWorks.find(w => w.platform_url === kkParsed.canonical);
      const readTitles = new Set<string>();
      if (matchedWork) {
        const chapters = await listChapters(matchedWork.id);
        for (const ch of chapters) readTitles.add(ch.title);
      }

      setKkPageInfo(pageInfo);
      setKkEpisodes(pageInfo.episodes.map(ep => ({
        ...ep,
        checked: readTitles.size === 0 || !readTitles.has(ep.title),
      })));
      setStep("kakuyomu-select");
      return;
    }

    // ── Syosetu ─────────────────────────────────────────────────
    const ssParsed = parseSyosetsuWorkUrl(url);
    if (ssParsed) {
      if (isSyosetsuChapterPage(url)) {
        setSsWorkUrl(ssParsed.canonical);
        setSsIsChapterPage(true);
        setStep("syosetu-unauthorized");
        return;
      }

      ssTabIdRef.current = tabId;
      setSsWorkUrl(ssParsed.canonical);
      setStep("syosetu-check");

      const authResult = await checkSyosetsuAuthorization(ssParsed.canonical);
      if (!authResult.authorized) {
        setStep("syosetu-unauthorized");
        return;
      }

      let pageInfo: SyosetsuPageInfo | null = null;
      try {
        pageInfo = await chrome.tabs.sendMessage(tabId, { type: "SS_GET_PAGE_INFO" }) as SyosetsuPageInfo | null;
      } catch {
        // Content script not running — inject it then retry
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/index.js"] });
          await new Promise(r => setTimeout(r, 200));
          pageInfo = await chrome.tabs.sendMessage(tabId, { type: "SS_GET_PAGE_INFO" }) as SyosetsuPageInfo | null;
        } catch { pageInfo = null; }
      }

      if (!pageInfo || pageInfo.chapters.length === 0) { setStep("pick"); return; }

      const existingWorks = await listWorks();
      const matchedWork = existingWorks.find(w => w.platform_url === ssParsed.canonical);
      const readTitles = new Set<string>();
      if (matchedWork) {
        const chapters = await listChapters(matchedWork.id);
        for (const ch of chapters) readTitles.add(ch.title);
      }

      setSsPageInfo(pageInfo);
      setSsChapters(pageInfo.chapters.map(ch => ({
        ...ch,
        checked: readTitles.size === 0 || !readTitles.has(ch.title),
      })));
      setStep("syosetu-select");
    }
    } catch { setStep("pick"); }
  };

  useEffect(() => {
    const activeSteps: Step[] = [
      "kakuyomu-check", "kakuyomu-select", "kakuyomu-run",
      "syosetu-check", "syosetu-select", "syosetu-run",
    ];

    const runDetection = (url: string, tabId: number) => {
      detectPlatformRef.current?.(url, tabId)?.catch(() => {});
    };

    // Run on mount
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url && tab.id != null) runDetection(tab.url, tab.id);
    });

    // Re-run when the active tab navigates (e.g. user was on pick screen, then navigated)
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (info.status !== "complete" || !tab.url || !tab.active) return;
      // Don't interrupt an in-progress import
      setStep(current => {
        if (!activeSteps.includes(current)) runDetection(tab.url!, tabId);
        return current;
      });
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => chrome.tabs.onUpdated.removeListener(onUpdated);
  }, []);

  const statusLabel = (s: AnalysisStatus): string => {
    if (s === "chunking")  return str.status_chunking;
    if (s === "analyzing") return str.status_analyzing_llm;
    if (s === "saving")          return str.status_saving;
    if (s === "profile_update")  return str.status_profile_update;
    if (s === "embedding")       return str.status_embedding;
    if (s === "done")      return str.status_done;
    if (s === "no_llm")    return str.status_no_llm;
    if (s === "error")     return str.status_error;
    return "";
  };

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
    if (!workForm.title || !workForm.author) { setError(str.ingest_error_fields); return; }
    setBusy(true); setError("");
    try {
      const w = await getOrCreateWork({ ...workForm, language: "other", source_type: "pasted" });
      await selectWork(w);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const handleIngest = async () => {
    if (!work || !chapterForm.full_text.trim()) { setError(str.ingest_error_text); return; }
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
      setBatchCurrent(str.chapter_label(pf.globalChapter, pf.title));
      try {
        const text = await pf.file.text();
        const errs: string[] = [];
        await ingestPastedText(
          work.id,
          pf.globalChapter,
          pf.title,
          text,
          () => {},
          (msg) => errs.push(msg),
        );
        if (errs.length > 0) setBatchErrors(prev => [...prev, ...errs]);
      } catch (err) {
        setBatchErrors(prev => [...prev, String(err)]);
      }
      setBatchDone(i + 1);
    }
    setBatchCurrent("");
  };

  const handleKkStart = async () => {
    const selected = kkEpisodes.filter(ep => ep.checked);
    if (selected.length === 0 || !kkPageInfo || kkTabIdRef.current === null) return;

    kkAbortRef.current = false;
    setKkDone(0);
    setKkErrors([]);
    setKkCurrent("");
    setStep("kakuyomu-run");

    const resultWork = await ingestKakuyomuWork({
      work_title: kkPageInfo.title,
      work_author: kkPageInfo.author,
      work_url: kkPageInfo.work_url,
      tab_id: kkTabIdRef.current,
      episodes: selected,
      language: "ja",
      onStatus: (msg) => setKkCurrent(statusLabel(msg as Parameters<typeof statusLabel>[0]) || msg),
      onProgress: (done) => setKkDone(done),
      onError: (msg) => setKkErrors(prev => [...prev, msg]),
      signal: { get aborted() { return kkAbortRef.current; } } as AbortSignal,
    });

    setKkCurrent("");
    if (resultWork) {
      setWork(resultWork);
    }
  };

  const handleSsStart = async () => {
    const selected = ssChapters.filter(ch => ch.checked);
    if (selected.length === 0 || !ssPageInfo || ssTabIdRef.current === null) return;

    ssAbortRef.current = false;
    setSsDone(0);
    setSsErrors([]);
    setSsCurrent("");
    setStep("syosetu-run");

    const resultWork = await ingestSyosetsuWork({
      work_title: ssPageInfo.title,
      work_author: ssPageInfo.author,
      work_url: ssPageInfo.work_url,
      ncode: ssPageInfo.ncode,
      tab_id: ssTabIdRef.current,
      chapters: selected,
      language: "ja",
      onStatus: (msg) => setSsCurrent(statusLabel(msg as Parameters<typeof statusLabel>[0]) || msg),
      onProgress: (done) => setSsDone(done),
      onError: (msg) => setSsErrors(prev => [...prev, msg]),
      signal: { get aborted() { return ssAbortRef.current; } } as AbortSignal,
    });

    setSsCurrent("");
    if (resultWork) setWork(resultWork);
  };

  const goBack = () => {
    if (step === "kakuyomu-check" || step === "kakuyomu-unauthorized" || step === "kakuyomu-select") {
      setStep("pick");
    } else if (step === "kakuyomu-run") {
      kkAbortRef.current = true; setStep("kakuyomu-select");
    } else if (step === "syosetu-check" || step === "syosetu-unauthorized" || step === "syosetu-select") {
      setStep("pick");
    } else if (step === "syosetu-run") {
      ssAbortRef.current = true; setStep("syosetu-select");
    } else if (step === "chapter" || step === "mode" || step === "batch-select") {
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
  const kkSelected = kkEpisodes.filter(ep => ep.checked).length;
  const kkFinished = step === "kakuyomu-run" && !kkCurrent && kkDone === kkEpisodes.filter(ep => ep.checked).length && kkDone > 0;
  const ssSelected = ssChapters.filter(ch => ch.checked).length;
  const ssFinished = step === "syosetu-run" && !ssCurrent && ssDone === ssChapters.filter(ch => ch.checked).length && ssDone > 0;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={goBack}>←</Button>
        <h2 className="text-sm font-semibold">{str.ingest_title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Step: kakuyomu-check ─────────────────────────────── */}
        {step === "kakuyomu-check" && (
          <p className="text-sm text-gray-500 text-center mt-8">{str.kk_checking_auth}</p>
        )}

        {/* ── Step: kakuyomu-unauthorized ──────────────────────── */}
        {step === "kakuyomu-unauthorized" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 break-all">{kkWorkUrl}</p>

            {kkIsEpisodePage ? (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{str.kk_work_page_required}</p>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{str.kk_unauthorized}</p>
            )}

            <p className="text-xs text-gray-400">{str.kk_unauthorized_reason}</p>

            {/* Fallback options for readers */}
            {!kkIsEpisodePage && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">{str.kk_fallback_header}</p>
                <button
                  className="w-full text-left px-3 py-2.5 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                  onClick={() => setStep("pick")}
                >
                  <p className="text-sm font-medium">{str.kk_fallback_manual}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{str.kk_fallback_manual_desc}</p>
                </button>
              </div>
            )}

            {/* Author registration link */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-400 mb-1.5">{str.kk_if_author}</p>
              <button
                onClick={() => onWorkRegister(kkWorkUrl)}
                className="block w-full text-center text-sm text-indigo-600 underline"
              >
                {str.kk_portal_link}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: kakuyomu-select ─────────────────────────────── */}
        {step === "kakuyomu-select" && kkPageInfo && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{str.kk_mode_header}</p>
            <p className="text-xs text-gray-600 font-medium">{kkPageInfo.title}</p>
            <p className="text-xs text-gray-400">{kkPageInfo.author}</p>

            <div className="flex gap-2">
              <button
                className="text-xs text-indigo-600 underline"
                onClick={() => setKkEpisodes(eps => eps.map(ep => ({ ...ep, checked: true })))}
              >{str.kk_select_all}</button>
              <button
                className="text-xs text-gray-400 underline"
                onClick={() => setKkEpisodes(eps => eps.map(ep => ({ ...ep, checked: false })))}
              >{str.kk_deselect_all}</button>
              <span className="ml-auto text-xs text-gray-500">{str.kk_episodes_selected(kkSelected)}</span>
            </div>

            <ul className="space-y-0.5 max-h-72 overflow-y-auto border border-gray-100 rounded p-2">
              {kkEpisodes.map((ep, idx) => (
                <li key={ep.episode_id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={ep.checked}
                    onChange={e => {
                      const checked = e.target.checked;
                      setKkEpisodes(prev => prev.map((item, i) => i === idx ? { ...item, checked } : item));
                    }}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-600 truncate">{ep.title}</span>
                </li>
              ))}
            </ul>

            <Button
              className="w-full"
              disabled={kkSelected === 0}
              onClick={handleKkStart}
            >
              {str.kk_start_import} ({kkSelected})
            </Button>
          </div>
        )}

        {/* ── Step: kakuyomu-run ───────────────────────────────── */}
        {step === "kakuyomu-run" && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">{str.kk_mode_header}</p>

            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{kkDone} / {kkEpisodes.filter(ep => ep.checked).length}</span>
                <span>{Math.round((kkDone / Math.max(kkEpisodes.filter(ep => ep.checked).length, 1)) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(kkDone / Math.max(kkEpisodes.filter(ep => ep.checked).length, 1)) * 100}%` }}
                />
              </div>
            </div>

            {kkCurrent && (
              <p className="text-xs text-indigo-600 truncate">{kkCurrent}</p>
            )}

            {kkErrors.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {kkErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {kkFinished && work && (
              <div className="space-y-2">
                <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
                  {str.ingest_done_msg(kkDone, kkErrors.length)}
                </p>
                <Button className="w-full" onClick={() => onDone(work, kkDone)}>
                  {str.ingest_done_btn}
                </Button>
              </div>
            )}

            {!kkFinished && (
              <Button variant="ghost" className="w-full" onClick={() => { kkAbortRef.current = true; }}>
                {str.ingest_abort}
              </Button>
            )}
          </div>
        )}

        {/* ── Step: syosetu-check ──────────────────────────────── */}
        {step === "syosetu-check" && (
          <p className="text-sm text-gray-500 text-center mt-8">{str.kk_checking_auth}</p>
        )}

        {/* ── Step: syosetu-unauthorized ───────────────────────── */}
        {step === "syosetu-unauthorized" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500 break-all">{ssWorkUrl}</p>

            {ssIsChapterPage ? (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{str.ss_work_page_required}</p>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">{str.kk_unauthorized}</p>
            )}

            <p className="text-xs text-gray-400">{str.ss_unauthorized_reason}</p>

            {!ssIsChapterPage && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">{str.kk_fallback_header}</p>
                <button
                  className="w-full text-left px-3 py-2.5 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                  onClick={() => setStep("pick")}
                >
                  <p className="text-sm font-medium">{str.kk_fallback_manual}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{str.kk_fallback_manual_desc}</p>
                </button>
              </div>
            )}

            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-400 mb-1.5">{str.kk_if_author}</p>
              <button
                onClick={() => onWorkRegister(ssWorkUrl)}
                className="block w-full text-center text-sm text-indigo-600 underline"
              >
                {str.kk_portal_link}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: syosetu-select ─────────────────────────────── */}
        {step === "syosetu-select" && ssPageInfo && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{str.ss_mode_header}</p>
            <p className="text-xs text-gray-600 font-medium">{ssPageInfo.title}</p>
            <p className="text-xs text-gray-400">{ssPageInfo.author}</p>

            <div className="flex gap-2">
              <button
                className="text-xs text-indigo-600 underline"
                onClick={() => setSsChapters(chs => chs.map(ch => ({ ...ch, checked: true })))}
              >{str.kk_select_all}</button>
              <button
                className="text-xs text-gray-400 underline"
                onClick={() => setSsChapters(chs => chs.map(ch => ({ ...ch, checked: false })))}
              >{str.kk_deselect_all}</button>
              <span className="ml-auto text-xs text-gray-500">{str.kk_episodes_selected(ssSelected)}</span>
            </div>

            <ul className="space-y-0.5 max-h-72 overflow-y-auto border border-gray-100 rounded p-2">
              {ssChapters.map((ch, idx) => (
                <li key={ch.chapter_num} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={ch.checked}
                    onChange={e => {
                      const checked = e.target.checked;
                      setSsChapters(prev => prev.map((item, i) => i === idx ? { ...item, checked } : item));
                    }}
                    className="rounded"
                  />
                  <span className="text-xs text-gray-600 truncate">{ch.title}</span>
                </li>
              ))}
            </ul>

            <Button
              className="w-full"
              disabled={ssSelected === 0}
              onClick={handleSsStart}
            >
              {str.kk_start_import} ({ssSelected})
            </Button>
          </div>
        )}

        {/* ── Step: syosetu-run ────────────────────────────────── */}
        {step === "syosetu-run" && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">{str.ss_mode_header}</p>

            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{ssDone} / {ssChapters.filter(ch => ch.checked).length}</span>
                <span>{Math.round((ssDone / Math.max(ssChapters.filter(ch => ch.checked).length, 1)) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(ssDone / Math.max(ssChapters.filter(ch => ch.checked).length, 1)) * 100}%` }}
                />
              </div>
            </div>

            {ssCurrent && (
              <p className="text-xs text-indigo-600 truncate">{ssCurrent}</p>
            )}

            {ssErrors.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {ssErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {ssFinished && work && (
              <div className="space-y-2">
                <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
                  {str.ingest_done_msg(ssDone, ssErrors.length)}
                </p>
                <Button className="w-full" onClick={() => onDone(work, ssDone)}>
                  {str.ingest_done_btn}
                </Button>
              </div>
            )}

            {!ssFinished && (
              <Button variant="ghost" className="w-full" onClick={() => { ssAbortRef.current = true; }}>
                {str.ingest_abort}
              </Button>
            )}
          </div>
        )}

        {/* ── Step: pick ─────────────────────────────────────── */}
        {step === "pick" && (
          <>
            {works.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.ingest_add_existing}</h3>
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
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.ingest_create_new_section}</h3>
              <Button className="w-full" onClick={() => { setStep("new-work"); setError(""); }}>
                {str.ingest_new_work_btn}
              </Button>
            </section>
          </>
        )}

        {/* ── Step: new-work ─────────────────────────────────── */}
        {step === "new-work" && (
          <>
            <p className="text-xs text-gray-500">{str.ingest_new_work_hint}</p>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{str.ingest_title_label}</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.title} onChange={e => setWorkForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{str.ingest_author_label}</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.author} onChange={e => setWorkForm(f => ({ ...f, author: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{str.ingest_platform_label}</label>
              <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={workForm.platform} onChange={e => setWorkForm(f => ({ ...f, platform: e.target.value as Work["platform"] }))}>
                <option value="syosetu">小説家になろう</option>
                <option value="kakuyomu">カクヨム</option>
                <option value="other">その他</option>
              </select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleNewWork} disabled={busy} className="w-full">{str.ingest_next}</Button>
          </>
        )}

        {/* ── Step: mode ─────────────────────────────────────── */}
        {step === "mode" && work && (
          <>
            <p className="text-xs text-gray-500 font-medium">{str.ingest_mode_title(work.title)}</p>
            <div className="space-y-2">
              <button
                onClick={() => setStep("batch-select")}
                className="w-full text-left px-4 py-3 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
              >
                <p className="text-sm font-medium">{str.ingest_batch_option}</p>
                <p className="text-xs text-gray-400 mt-0.5">{str.ingest_batch_desc}</p>
              </button>
              <button
                onClick={() => setStep("chapter")}
                className="w-full text-left px-4 py-3 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
              >
                <p className="text-sm font-medium">{str.ingest_single_option}</p>
                <p className="text-xs text-gray-400 mt-0.5">{str.ingest_single_desc}</p>
              </button>
            </div>
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
            <p className="text-xs text-gray-500 font-medium">{str.ingest_chapter_header(work.title)}</p>
            <div className="flex gap-2">
              <div className="w-24">
                <label className="block text-xs text-gray-600 mb-1">{str.ingest_chapter_num}</label>
                <input type="number" min={1} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={chapterForm.chapter_number} onChange={e => setChapterForm(f => ({ ...f, chapter_number: Number(e.target.value) }))} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-600 mb-1">{str.ingest_chapter_title_label}</label>
                <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" value={chapterForm.title} onChange={e => setChapterForm(f => ({ ...f, title: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">{str.ingest_chapter_text}</label>
              <textarea
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                rows={12}
                placeholder={str.ingest_chapter_ph}
                value={chapterForm.full_text}
                onChange={e => setChapterForm(f => ({ ...f, full_text: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">{str.ingest_char_count(chapterForm.full_text.length.toLocaleString())}</p>
            </div>
            {status !== "idle" && (
              <p className={`text-xs ${status === "error" ? "text-red-600" : status === "done" ? "text-green-600" : "text-indigo-600"}`}>
                {statusLabel(status)}
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button onClick={handleIngest} disabled={busy || !chapterForm.full_text.trim()} className="w-full">
              {busy ? (statusLabel(status) || str.ingest_processing) : str.ingest_btn}
            </Button>
          </>
        )}

        {/* ── Step: batch-select ─────────────────────────────── */}
        {step === "batch-select" && work && (
          <>
            <p className="text-xs text-gray-500 font-medium">{str.ingest_batch_title(work.title)}</p>
            {batchFiles.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  {str.ingest_batch_hint}<br />
                  {str.ingest_batch_format} <code className="bg-gray-100 px-1 rounded">第一部_第01章_タイトル.md</code>
                </p>
                <Button
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {str.ingest_select_files}
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
                  <p className="text-xs text-gray-500">
                    {str.ingest_file_count(batchFiles.length, batchFiles[0].globalChapter, batchFiles[batchFiles.length - 1].globalChapter)}
                  </p>
                  <button className="text-xs text-indigo-600 underline" onClick={() => { setBatchFiles([]); fileInputRef.current?.click(); }}>
                    {str.ingest_reselect}
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
                        >↑</button>
                        <button
                          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-default"
                          disabled={idx === batchFiles.length - 1}
                          onClick={() => moveFile(idx, 1)}
                        >↓</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button className="w-full" onClick={handleBatchStart}>
                  {str.ingest_start_batch(batchFiles.length)}
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Step: batch-run ────────────────────────────────── */}
        {step === "batch-run" && (
          <>
            <p className="text-xs text-gray-500 font-medium">{str.ingest_running(work?.title ?? "")}</p>

            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{batchDone} / {batchFiles.length}</span>
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
              <p className="text-xs text-indigo-600 truncate">{str.ingest_analyzing(batchCurrent)}</p>
            )}

            {batchErrors.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 space-y-0.5 max-h-32 overflow-y-auto">
                {batchErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            {batchFinished && (
              <div className="space-y-2">
                <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
                  {str.ingest_done_msg(batchDone, batchErrors.length)}
                </p>
                <Button className="w-full" onClick={() => onDone(work!, batchFiles[batchFiles.length - 1].globalChapter)}>
                  {str.ingest_done_btn}
                </Button>
              </div>
            )}

            {!batchFinished && (
              <Button variant="ghost" className="w-full" onClick={() => { abortRef.current = true; }}>
                {str.ingest_abort}
              </Button>
            )}
          </>
        )}

      </div>
    </div>
  );
}

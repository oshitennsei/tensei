import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { generatePlan } from "@/lib/performance";
import { db } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";
import type { Work, PerformanceSession, Chapter, SceneBasis, ProductionPlan } from "@/lib/storage";

async function loadSettings(): Promise<{ maxLoops: number; qualityCheck: boolean }> {
  const s = await db.app_settings.get("global");
  return { maxLoops: s?.plan_max_loops ?? 3, qualityCheck: s?.scene_quality_check !== false };
}

async function saveMaxLoops(v: number): Promise<void> {
  const existing = await db.app_settings.get("global");
  if (existing) await db.app_settings.update("global", { plan_max_loops: v });
  else await db.app_settings.add({ id: "global", plan_max_loops: v });
}

async function saveQualityCheck(v: boolean): Promise<void> {
  const existing = await db.app_settings.get("global");
  if (existing) await db.app_settings.update("global", { scene_quality_check: v });
  else await db.app_settings.add({ id: "global", scene_quality_check: v });
}

interface Props {
  work: Work;
  session: PerformanceSession;
  onBack: () => void;
  onPlanReady: (plan: ProductionPlan, updatedSession: PerformanceSession) => void;
}

interface LogLine {
  icon: string;
  text: string;
  dim?: boolean;
}

export function SceneBriefScreen({ work, session, onBack, onPlanReady }: Props) {
  const str = useStrings();
  const [basis, setBasis] = useState<SceneBasis>("virtual");
  const [referenceChapter, setReferenceChapter] = useState<number>(1);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [description, setDescription] = useState("");
  const [maxLoops, setMaxLoops] = useState(3);
  const [qualityCheck, setQualityCheck] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState("");
  const logBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const [chs, settings] = await Promise.all([
        db.chapters.where("work_id").equals(work.id).sortBy("chapter_number"),
        loadSettings(),
      ]);
      setChapters(chs);
      setMaxLoops(settings.maxLoops);
      setQualityCheck(settings.qualityCheck);
      if (chs.length > 0) setReferenceChapter(chs[chs.length - 1].chapter_number);
    };
    load();
  }, [work.id]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const appendLog = (line: LogLine) => setLog(prev => [...prev, line]);
  const markLastDone = () =>
    setLog(prev => prev.map((l, i) => i === prev.length - 1 ? { ...l, dim: true } : l));

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setLog([]);

    try {
      for await (const event of generatePlan(
        session,
        basis,
        description.trim(),
        basis === "chapter" ? referenceChapter : undefined,
      )) {
        switch (event.type) {
          case "planning":
            appendLog({ icon: "🔍", text: str.log_planning(event.round) });
            break;
          case "fetching":
            markLastDone();
            for (const task of event.tasks)
              appendLog({ icon: "  ⊡", text: task });
            break;
          case "evaluating":
            appendLog({ icon: "🔍", text: str.log_evaluating(event.round) });
            break;
          case "writing":
            markLastDone();
            appendLog({ icon: "✍", text: str.log_writing });
            break;
          case "segmenting":
            markLastDone();
            appendLog({ icon: "✂", text: str.log_segmenting });
            break;
          case "done":
            markLastDone();
            appendLog({ icon: "✓", text: str.log_done });
            onPlanReady(event.plan, event.session);
            break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "計画の生成に失敗しました。");
    } finally {
      setGenerating(false);
    }
  };

  const basisOptions: Array<{ value: SceneBasis; label: string; description: string }> = [
    { value: "chapter",     label: str.basis_chapter,     description: str.basis_chapter_desc },
    { value: "post_story",  label: str.basis_post_story,  description: str.basis_post_story_desc },
    { value: "spinoff",     label: str.basis_spinoff,     description: str.basis_spinoff_desc },
    { value: "virtual",     label: str.basis_virtual,     description: str.basis_virtual_desc },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={generating}>←</Button>
        <p className="text-sm font-semibold flex-1">{str.brief_title}</p>
      </header>

      {generating ? (
        /* Progress log view */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 font-mono text-xs">
          {log.map((line, i) => (
            <div key={i} className={`flex gap-2 ${line.dim ? "text-gray-400" : "text-gray-700"}`}>
              <span className="shrink-0 w-5">{line.icon}</span>
              <span>{line.text}</span>
            </div>
          ))}
          {!error && (
            <div className="flex gap-2 text-indigo-500 animate-pulse">
              <span className="shrink-0 w-5">▶</span>
              <span>{str.brief_processing}</span>
            </div>
          )}
          <div ref={logBottomRef} />
        </div>
      ) : (
        /* Input form */
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.brief_type_label}</p>
            <div className="grid grid-cols-2 gap-2">
              {basisOptions.map(opt => (
                <button
                  key={opt.value}
                  className={`flex flex-col items-start px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    basis === opt.value
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-gray-100 text-gray-700 border-gray-100 hover:border-gray-300"
                  }`}
                  onClick={() => setBasis(opt.value)}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className={`text-xs mt-0.5 ${basis === opt.value ? "text-indigo-200" : "text-gray-500"}`}>
                    {opt.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {basis === "chapter" && (
            <section>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.brief_chapter_label}</p>
              <select
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={referenceChapter}
                onChange={e => setReferenceChapter(Number(e.target.value))}
              >
                {chapters.map(ch => (
                  <option key={ch.id} value={ch.chapter_number}>
                    第{ch.chapter_number}章 {ch.title}
                  </option>
                ))}
                {chapters.length === 0 && <option value={1}>第1章</option>}
              </select>
            </section>
          )}

          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
              {str.brief_desc_label}
            </p>
            <textarea
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
              rows={6}
              placeholder={`例：\n・第3章のエレナと国王の謁見シーン\n・戦争が終わって2年後、エレナが故郷に戻ってくる場面\n・エレナとソフィアが温泉旅館でくつろぐ番外篇`}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </section>

          <section>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">{str.brief_loops_label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{str.brief_loops_desc}</p>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5, 10].map(n => (
                  <button
                    key={n}
                    className={`w-8 h-7 rounded text-xs font-mono transition-colors ${
                      maxLoops === n
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                    onClick={() => { setMaxLoops(n); saveMaxLoops(n); }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {basis === "chapter" && (
            <section>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">{str.brief_quality_check_label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{str.brief_quality_check_desc}</p>
                </div>
                <button
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${qualityCheck ? "bg-indigo-600" : "bg-gray-300"}`}
                  onClick={() => { const v = !qualityCheck; setQualityCheck(v); saveQualityCheck(v); }}
                  aria-pressed={qualityCheck}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${qualityCheck ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      <div className="border-t border-gray-200 p-4 shrink-0">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        {!generating && (
          <Button
            className="w-full"
            disabled={!description.trim()}
            onClick={handleGenerate}
          >
            {str.brief_generate}
          </Button>
        )}
      </div>
    </div>
  );
}

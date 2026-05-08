import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { generatePlan } from "@/lib/performance";
import { db } from "@/lib/storage";
import type { Work, PerformanceSession, Chapter, SceneBasis, ProductionPlan } from "@/lib/storage";

interface Props {
  work: Work;
  session: PerformanceSession;
  onBack: () => void;
  onPlanReady: (plan: ProductionPlan, updatedSession: PerformanceSession) => void;
}

export function SceneBriefScreen({ work, session, onBack, onPlanReady }: Props) {
  const [basis, setBasis] = useState<SceneBasis>("virtual");
  const [referenceChapter, setReferenceChapter] = useState<number>(1);
  const [maxChapter, setMaxChapter] = useState<number>(1);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      const chs = await db.chapters
        .where("work_id")
        .equals(work.id)
        .sortBy("chapter_number");
      setChapters(chs);
      if (chs.length > 0) {
        const max = chs[chs.length - 1].chapter_number;
        setMaxChapter(max);
        setReferenceChapter(max);
      }
    };
    load();
  }, [work.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const { plan, session: updatedSession } = await generatePlan(
        session,
        basis,
        description.trim(),
        basis === "chapter" ? referenceChapter : undefined,
      );
      onPlanReady(plan, updatedSession);
    } catch (e) {
      setError(e instanceof Error ? e.message : "計画の生成に失敗しました。");
    } finally {
      setGenerating(false);
    }
  };

  const basisOptions: Array<{ value: SceneBasis; label: string; description: string }> = [
    { value: "chapter",     label: "章のシーン",   description: "原作の章を再現" },
    { value: "post_story",  label: "後日談",        description: "物語の後の話" },
    { value: "spinoff",     label: "番外篇",        description: "もしもの話" },
    { value: "virtual",     label: "架空シーン",    description: "完全な創作" },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">場面の概要</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* 場面の種類 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">場面の種類</p>
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

        {/* 章を選択 */}
        {basis === "chapter" && (
          <section>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">章を選択</p>
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
              {chapters.length === 0 && (
                <option value={1}>第1章</option>
              )}
            </select>
          </section>
        )}

        {/* 説明 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
            どんな場面を演じますか？
          </p>
          <textarea
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={6}
            placeholder={`例：\n・第3章のエレナと国王の謁見シーン\n・戦争が終わって2年後、エレナが故郷に戻ってくる場面\n・エレナとソフィアが温泉旅館でくつろぐ番外篇`}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </section>
      </div>

      <div className="border-t border-gray-200 p-4 shrink-0">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <Button
          className="w-full"
          disabled={generating || !description.trim()}
          onClick={handleGenerate}
        >
          {generating ? "演出計画を生成中..." : "演出計画を生成 →"}
        </Button>
      </div>
    </div>
  );
}

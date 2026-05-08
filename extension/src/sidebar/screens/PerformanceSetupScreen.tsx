import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { createPerformanceSession } from "@/lib/performance";
import { db } from "@/lib/storage";
import type { Work, Entity, PerformanceSession, PerformanceMode, ImprovSetting } from "@/lib/storage";

interface Props {
  work: Work;
  onBack: () => void;
  onStart: (session: PerformanceSession) => void;
  onManageCharacters: () => void;
}

export function PerformanceSetupScreen({ work, onBack, onStart, onManageCharacters }: Props) {
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [maxChapter, setMaxChapter] = useState<number>(1);
  const [cutoffChapter, setCutoffChapter] = useState<number>(1);
  const [mode, setMode] = useState<PerformanceMode>("director");
  const [improv, setImprov] = useState<ImprovSetting>("moderate");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [chars, chapters] = await Promise.all([
        db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
        db.chapters.where("work_id").equals(work.id).toArray(),
      ]);
      setCharacters(chars);
      if (chapters.length > 0) {
        const max = Math.max(...chapters.map(c => c.chapter_number));
        setMaxChapter(max);
        setCutoffChapter(max);
      }
    };
    load();
  }, [work.id]);

  const toggleCharacter = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleStart = async () => {
    if (selectedIds.size === 0 || starting) return;
    setStarting(true);
    try {
      const session = await createPerformanceSession(
        work.id,
        [...selectedIds],
        mode,
        cutoffChapter,
        improv,
      );
      onStart(session);
    } finally {
      setStarting(false);
    }
  };

  const modes: Array<{ value: PerformanceMode; label: string; description: string }> = [
    { value: "director", label: "監督", description: "あなたが演出を指示" },
    { value: "screenwriter", label: "脚本家", description: "場面の方向性を指示" },
    { value: "cast", label: "キャスト", description: "あなたも登場人物として参加" },
    { value: "hybrid", label: "ハイブリッド", description: "全て担当" },
  ];

  const improvOptions: Array<{ value: ImprovSetting; label: string; description: string }> = [
    { value: "strict", label: "厳密", description: "原作に忠実" },
    { value: "moderate", label: "標準", description: "バランス" },
    { value: "free", label: "自由", description: "自由な展開" },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold truncate flex-1">{work.title} — パフォーマンス設定</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* キャラクター選択 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">キャラクター選択</p>
          {characters.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">キャラクターが登録されていません。</p>
              <Button variant="ghost" size="sm" onClick={onManageCharacters}>
                キャラクターを管理 →
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {characters.map(c => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-indigo-600 rounded"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleCharacter(c.id)}
                    />
                    <span className="text-sm text-gray-800">{c.canonical_name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 章cutoff */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">どの章まで（ネタバレ防止）</p>
          <input
            type="number"
            min={1}
            max={maxChapter}
            value={cutoffChapter}
            onChange={e => setCutoffChapter(Math.max(1, Math.min(maxChapter, Number(e.target.value))))}
            className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-xs text-gray-400 ml-2">/ 第{maxChapter}章</span>
        </section>

        {/* モード */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">モード</p>
          <div className="grid grid-cols-2 gap-2">
            {modes.map(m => (
              <button
                key={m.value}
                className={`flex flex-col items-start px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  mode === m.value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-gray-100 text-gray-700 border-gray-100 hover:border-gray-300"
                }`}
                onClick={() => setMode(m.value)}
              >
                <span className="text-sm font-semibold">{m.label}</span>
                <span className={`text-xs mt-0.5 ${mode === m.value ? "text-indigo-200" : "text-gray-500"}`}>
                  {m.description}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 即興度 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">即興度</p>
          <div className="flex gap-2">
            {improvOptions.map(opt => (
              <button
                key={opt.value}
                className={`flex-1 flex flex-col items-center px-2 py-2.5 rounded-lg border text-center transition-colors ${
                  improv === opt.value
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-gray-100 text-gray-700 border-gray-100 hover:border-gray-300"
                }`}
                onClick={() => setImprov(opt.value)}
              >
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className={`text-xs mt-0.5 ${improv === opt.value ? "text-indigo-200" : "text-gray-500"}`}>
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="border-t border-gray-200 p-4 shrink-0">
        <Button
          className="w-full"
          disabled={selectedIds.size === 0 || starting}
          onClick={handleStart}
        >
          {starting ? "開始中..." : "開始"}
        </Button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button } from "../components/Button";
import { generateBtsSetup, createBtsSession } from "@/lib/bts";
import type { BtsSetup } from "@/lib/bts";
import type { Work, PerformanceSession, BtsLocation, BtsSession } from "@/lib/storage";

interface Props {
  work: Work;
  performanceSession: PerformanceSession;
  onBack: () => void;
  onReady: (setup: BtsSetup, session: BtsSession) => void;
}

interface LocationOption {
  value: BtsLocation;
  label: string;
  sublabel: string;
}

const LOCATION_OPTIONS: LocationOption[] = [
  { value: "makeup_room", label: "化粧室", sublabel: "ヘアメイク・衣装" },
  { value: "set", label: "撮影セット", sublabel: "照明・収音あり" },
  { value: "rest_area", label: "休憩室", sublabel: "のんびり" },
  { value: "cafeteria", label: "食堂", sublabel: "食事・雑談" },
];

export function BtsBriefScreen({ work, performanceSession, onBack, onReady }: Props) {
  const [mode, setMode] = useState<"quick" | "describe">("quick");
  const [quickLocation, setQuickLocation] = useState<BtsLocation>("rest_area");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleEnter = async () => {
    if (generating) return;
    setError("");
    setGenerating(true);

    try {
      let setup: BtsSetup;
      if (mode === "quick") {
        setup = { location: quickLocation, crew: [] };
        const session = await createBtsSession(
          work.id,
          performanceSession.characters_in_scene,
          quickLocation,
          []
        );
        onReady(setup, session);
      } else {
        setup = await generateBtsSetup(performanceSession, description);
        const session = await createBtsSession(
          work.id,
          performanceSession.characters_in_scene,
          setup.location,
          setup.crew
        );
        onReady(setup, session);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "エラーが発生しました。");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">楽屋の設定</p>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Mode tabs */}
        <div className="flex gap-2">
          <button
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              mode === "quick"
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
            onClick={() => setMode("quick")}
          >
            クイック設定
          </button>
          <button
            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              mode === "describe"
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
            onClick={() => setMode("describe")}
          >
            詳細設定（AI）
          </button>
        </div>

        {/* Quick mode panel */}
        {mode === "quick" && (
          <div className="grid grid-cols-2 gap-2">
            {LOCATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`flex flex-col items-start px-3 py-2.5 rounded border text-left transition-colors ${
                  quickLocation === opt.value
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => setQuickLocation(opt.value)}
              >
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="text-xs text-gray-400 mt-0.5">{opt.sublabel}</span>
              </button>
            ))}
          </div>
        )}

        {/* Describe mode panel */}
        {mode === "describe" && (
          <div>
            <textarea
              rows={4}
              placeholder="例：化粧室でエレナ役の声優と監督が次の幕を相談している"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 p-4 shrink-0">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <Button
          className="w-full"
          disabled={generating || (mode === "describe" && !description.trim())}
          onClick={handleEnter}
        >
          {generating ? "設定中..." : "楽屋へ入る →"}
        </Button>
      </div>
    </div>
  );
}

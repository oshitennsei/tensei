import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import { generateNextScene, appendSegment, getPlanForSession } from "@/lib/performance";
import { LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { Work, PerformanceSession, Entity, ProductionPlan } from "@/lib/storage";

interface Props {
  work: Work;
  session: PerformanceSession;
  onBack: () => void;
  onGoBackstage: (session: PerformanceSession) => void;
}

export function PerformanceScreen({ work, session, onBack, onGoBackstage }: Props) {
  const [localSession, setLocalSession] = useState<PerformanceSession>(session);
  const [streamingContent, setStreamingContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [direction, setDirection] = useState("");
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [plan, setPlan] = useState<ProductionPlan | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const ids = localSession.characters_in_scene;
      const [chars, loadedPlan] = await Promise.all([
        Promise.all(ids.map(id => db.entities.get(id))),
        getPlanForSession(localSession.id),
      ]);
      setCharacters(chars.filter((c): c is Entity => c !== undefined));
      setPlan(loadedPlan);
    };
    load();
  }, [localSession.id]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setStreamingContent("");
    setError(null);

    abortRef.current = new AbortController();
    let accumulated = "";

    try {
      for await (const delta of generateNextScene(localSession, direction, abortRef.current.signal, plan)) {
        accumulated += delta;
        setStreamingContent(accumulated);
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
      await appendSegment(localSession.id, accumulated);
      const updated = await db.performance_sessions.get(localSession.id);
      if (updated) setLocalSession(updated);
      setStreamingContent("");
      setDirection("");
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = e instanceof LlmError ? e.userMessage : "エラーが発生しました。";
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleStop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">パフォーマンス</p>
        <Button variant="ghost" size="sm" onClick={() => onGoBackstage(localSession)}>
          楽屋へ
        </Button>
      </header>

      {/* Character chips */}
      {characters.length > 0 && (
        <div className="flex gap-1.5 px-3 py-2 flex-wrap border-b border-gray-100 shrink-0">
          {characters.map(c => (
            <span
              key={c.id}
              className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded-full"
            >
              {c.canonical_name}
            </span>
          ))}
        </div>
      )}

      {/* Script display */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {localSession.generated_content.length === 0 && !streamingContent && (
          <p className="text-center text-xs text-gray-400 mt-8">
            下の入力欄に演出を入力して「生成」を押してください。（空欄でも可）
          </p>
        )}
        {localSession.generated_content.map(segment => (
          <div
            key={segment.segment_id}
            className="mb-4 p-3 bg-white/70 rounded-lg text-sm whitespace-pre-wrap leading-relaxed"
          >
            {segment.content}
          </div>
        ))}
        {streamingContent && (
          <div className="mb-4 p-3 bg-white/70 rounded-lg text-sm whitespace-pre-wrap leading-relaxed border-l-2 border-indigo-400 pl-3 italic opacity-80">
            {streamingContent}
          </div>
        )}
        {error && (
          <div className="text-center">
            <span className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{error}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Direction input */}
      <div className="border-t border-gray-200 p-3 shrink-0 space-y-2">
        {/* Crew action bar */}
        {!generating && (
          <div className="flex gap-1 flex-wrap">
            {([
              { label: "アクション！", text: "【場記：カチンコ！アクション！】" },
              { label: "カット！", text: "【監督：カット！もう一度やり直し】" },
              { label: "道具確認", text: "【道具担当：小道具の確認が必要】" },
              { label: "音声チェック", text: "【音声：マイクレベル調整、少し待って】" },
              { label: "監督コメント", text: "【監督コメント：" },
            ] as const).map(({ label, text }) => (
              <button
                key={label}
                className="px-2 py-0.5 text-xs rounded border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                onClick={() => setDirection(d => d ? d + "\n" + text : text)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            rows={2}
            placeholder="次の展開を指示... (空欄でも可)"
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={direction}
            onChange={e => setDirection(e.target.value)}
            disabled={generating}
          />
          {generating
            ? <Button variant="ghost" size="sm" onClick={handleStop} className="self-end">停止</Button>
            : (
              <Button size="sm" onClick={handleGenerate} className="self-end">
                生成
              </Button>
            )
          }
        </div>
      </div>
    </div>
  );
}

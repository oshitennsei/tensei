import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import { generateNextScene, appendSegment, getPlanForSession, downloadPerformanceLog } from "@/lib/performance";
import { LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";
import type { Work, PerformanceSession, Entity, ProductionPlan, AppSettings } from "@/lib/storage";

interface Props {
  work: Work;
  session: PerformanceSession;
  onBack: () => void;
  onGoBackstage: (session: PerformanceSession) => void;
}

export function PerformanceScreen({ work, session, onBack, onGoBackstage }: Props) {
  const str = useStrings();
  const [localSession, setLocalSession] = useState<PerformanceSession>(session);
  const [streamingContent, setStreamingContent] = useState("");
  const [progressStep, setProgressStep] = useState<"generating" | "evaluating" | "retrying" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [direction, setDirection] = useState("");
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [plan, setPlan] = useState<ProductionPlan | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debugPromptRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const ids = localSession.characters_in_scene;
      const [chars, loadedPlan, settings] = await Promise.all([
        Promise.all(ids.map(id => db.entities.get(id))),
        getPlanForSession(localSession.id),
        db.app_settings.get("global"),
      ]);
      setCharacters(chars.filter((c): c is Entity => c !== undefined));
      setPlan(loadedPlan);
      setAppSettings(settings ?? null);
    };
    load();
  }, [localSession.id]);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setStreamingContent("");
    setProgressStep(null);
    setError(null);

    abortRef.current = new AbortController();
    debugPromptRef.current = undefined;
    let finalContent = "";

    try {
      for await (const chunk of generateNextScene(
        localSession, direction, abortRef.current.signal, plan,
        (p) => { debugPromptRef.current = p; },
      )) {
        if (chunk.type === "stream") {
          finalContent += chunk.delta;
          setStreamingContent(finalContent);
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        } else if (chunk.type === "progress") {
          setProgressStep(chunk.step);
        } else if (chunk.type === "done") {
          finalContent = chunk.content;
        }
      }
      await appendSegment(localSession.id, finalContent, debugPromptRef.current);
      const updated = await db.performance_sessions.get(localSession.id);
      if (updated) setLocalSession(updated);
      setStreamingContent("");
      setProgressStep(null);
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
        <p className="text-sm font-semibold flex-1">{str.perf_screen_title}</p>
        {appSettings?.plan_debug_mode && (
          <Button variant="ghost" size="sm" onClick={() => downloadPerformanceLog(localSession)}>
            {str.perf_download_log}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onGoBackstage(localSession)}>
          {str.perf_backstage}
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
        {progressStep && (
          <div className="mb-4 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-600 flex items-center gap-2 animate-pulse">
            <span>▶</span>
            <span>{str[`perf_step_${progressStep}`]}</span>
          </div>
        )}
        {!progressStep && streamingContent && (
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
              { label: str.action_label_continue,  text: str.action_text_continue },
              { label: str.action_label_action,    text: str.action_text_action },
              { label: str.action_label_cut,       text: str.action_text_cut },
              { label: str.action_label_props,     text: str.action_text_props },
              { label: str.action_label_audio,     text: str.action_text_audio },
              { label: str.action_label_director,  text: str.action_text_director },
            ]).map(({ label, text }) => (
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

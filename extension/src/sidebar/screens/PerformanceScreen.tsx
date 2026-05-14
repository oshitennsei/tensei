import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "../components/Button";
import { generateNextScene, generateCastReactions, appendSegment, appendUserLine, getPlanForSession, downloadPerformanceLog } from "@/lib/performance";
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
  // Cast mode
  const [castPhase, setCastPhase] = useState<"generating" | "waiting_user" | null>(null);
  const [userLine, setUserLine] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const debugPromptRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isCast = localSession.mode === "cast";

  const userCharName = useMemo(() => {
    if (!isCast) return "";
    const c = characters.find(ch => ch.id === localSession.user_character_id) ?? characters[0];
    return c?.canonical_name ?? "";
  }, [isCast, characters, localSession.user_character_id]);

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

  // Cast mode: determine initial phase based on existing content
  useEffect(() => {
    if (!isCast) return;
    const segs = localSession.generated_content;
    const last = segs[segs.length - 1];
    if (!last || last.segment_type === "user_line") {
      // Need LLM to react (first time or after user line)
      triggerCastGenerate();
    } else {
      setCastPhase("waiting_user");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerCastGenerate = () => {
    // Use setTimeout to allow state to settle before async work
    setTimeout(() => handleCastGenerate(), 0);
  };

  const handleCastGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setCastPhase("generating");
    setStreamingContent("");
    setProgressStep(null);
    setError(null);

    abortRef.current = new AbortController();
    debugPromptRef.current = undefined;
    let finalContent = "";

    try {
      const currentSession = await db.performance_sessions.get(localSession.id) ?? localSession;
      const currentPlan = plan ?? await getPlanForSession(localSession.id) ?? undefined;

      for await (const chunk of generateCastReactions(
        currentSession, abortRef.current.signal, currentPlan,
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
      setCastPhase("waiting_user");
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = e instanceof LlmError ? e.userMessage : "エラーが発生しました。";
        setError(msg);
        setCastPhase("waiting_user");
      } else {
        setCastPhase("waiting_user");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCastSubmit = async () => {
    if (!userLine.trim() || generating) return;
    const line = userLine.trim();
    setUserLine("");
    await appendUserLine(localSession.id, userCharName, line);
    const updated = await db.performance_sessions.get(localSession.id);
    if (updated) setLocalSession(updated);
    handleCastGenerate();
  };

  const handleCastKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCastSubmit();
    }
  };

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

  const handleStop = () => {
    abortRef.current?.abort();
  };

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
              className={`px-2 py-0.5 text-xs rounded-full ${
                isCast && c.id === localSession.user_character_id
                  ? "bg-indigo-100 text-indigo-700 font-semibold"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              {c.canonical_name}{isCast && c.id === localSession.user_character_id ? " ★" : ""}
            </span>
          ))}
        </div>
      )}

      {/* Script display */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {localSession.generated_content.length === 0 && !streamingContent && !generating && (
          <p className="text-center text-xs text-gray-400 mt-8">
            {isCast ? str.cast_generating : "下の入力欄に演出を入力して「生成」を押してください。（空欄でも可）"}
          </p>
        )}
        {localSession.generated_content.map(segment => (
          segment.segment_type === "user_line" ? (
            <div
              key={segment.segment_id}
              className="mb-2 ml-4 p-3 bg-indigo-50 rounded-lg border-l-4 border-indigo-400 text-sm"
            >
              {segment.speaker_name && (
                <p className="text-xs font-semibold text-indigo-500 mb-1">{segment.speaker_name}</p>
              )}
              <p className="text-gray-800 whitespace-pre-wrap">{segment.content}</p>
            </div>
          ) : (
            <div
              key={segment.segment_id}
              className="mb-4 p-3 bg-white/70 rounded-lg text-sm whitespace-pre-wrap leading-relaxed"
            >
              {segment.content}
            </div>
          )
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

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 shrink-0 space-y-2">
        {isCast ? (
          // Cast mode input
          castPhase === "waiting_user" ? (
            <div>
              <p className="text-xs font-semibold text-indigo-600 mb-1.5">{str.cast_your_turn}</p>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  placeholder={str.cast_placeholder(userCharName)}
                  className="flex-1 border border-indigo-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={userLine}
                  onChange={e => setUserLine(e.target.value)}
                  onKeyDown={handleCastKeyDown}
                  autoFocus
                />
                <Button size="sm" onClick={handleCastSubmit} disabled={!userLine.trim()} className="self-end">
                  {str.cast_send}
                </Button>
              </div>
            </div>
          ) : castPhase === "generating" ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 animate-pulse">{str.cast_generating}</span>
              <Button variant="ghost" size="sm" onClick={handleStop}>停止</Button>
            </div>
          ) : null
        ) : (
          // Director / screenwriter / hybrid mode: original UI
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

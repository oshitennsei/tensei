import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import { chat } from "@/lib/chat";
import { createNewSession } from "@/lib/memory";
import { LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { Session, Work } from "@/lib/storage";
import { HARD_LIMITS } from "@/lib/content-safety";

interface Props {
  work: Work;
  session: Session;
  onBack: () => void;
}

interface Message {
  role: "user" | "character" | "system";
  content: string;
}

export function ChatScreen({ work, session: initialSession, onBack }: Props) {
  const [session, setSession] = useState<Session>(initialSession);
  const [messages, setMessages] = useState<Message[]>(() =>
    initialSession.tier_0_recent_turns.map(t => ({ role: t.role, content: t.content }))
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [characterName, setCharacterName] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.entities.get(session.character_id).then(entity => {
      setCharacterName(entity?.canonical_name ?? "キャラクター");
    });
  }, [session.character_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);

    abortRef.current = new AbortController();
    const result = await chat({ session, user_message: userMsg, signal: abortRef.current.signal });

    if (!result.ok) {
      setMessages(prev => [...prev, { role: "system", content: result.error.message }]);
      setStreaming(false);
      return;
    }

    setMessages(prev => [...prev, { role: "character", content: "" }]);

    let accumulated = "";
    try {
      for await (const delta of result.stream) {
        accumulated += delta;
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "character", content: accumulated };
          return next;
        });
      }
      const updated = await db.sessions.get(session.id);
      if (updated) setSession(updated);
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = e instanceof LlmError ? e.userMessage : "エラーが発生しました。";
        setMessages(prev => [...prev, { role: "system", content: msg }]);
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleNewSession = async () => {
    if (streaming) return;
    const s = await createNewSession(work.id, session.character_id, session.cutoff_chapter);
    setSession(s);
    setMessages([]);
    setInput("");
  };

  const remaining = HARD_LIMITS.max_input_chars - input.length;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{characterName}</p>
          <p className="text-xs text-gray-400 truncate">{work.title} · 第{session.cutoff_chapter}章まで</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleNewSession} disabled={streaming}>
          新規
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && !streaming && (
          <p className="text-center text-xs text-gray-400 mt-8">{characterName}と会話を始めましょう。</p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} characterName={characterName} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-200 p-3 shrink-0">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={2}
            placeholder="メッセージを入力..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={streaming}
          />
          {streaming
            ? <Button variant="ghost" size="sm" onClick={handleStop} className="self-end">停止</Button>
            : <Button size="sm" onClick={handleSend} disabled={!input.trim()} className="self-end">送信</Button>
          }
        </div>
        {remaining < 200 && (
          <p className={`text-xs mt-1 ${remaining < 0 ? "text-red-500" : "text-gray-400"}`}>
            残り {remaining} 文字
          </p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message, characterName }: { message: Message; characterName: string }) {
  if (message.role === "system") {
    return (
      <div className="text-center">
        <span className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{message.content}</span>
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%]`}>
        {!isUser && <p className="text-xs text-gray-400 mb-0.5">{characterName}</p>}
        <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isUser ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-900"
        }`}>
          {message.content || <span className="animate-pulse">▋</span>}
        </div>
      </div>
    </div>
  );
}

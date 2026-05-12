import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import { chat } from "@/lib/chat";
import { createNewSession } from "@/lib/memory";
import { LlmError } from "@/lib/llm";
import { db } from "@/lib/storage";
import type { Session, Work, VoiceSample } from "@/lib/storage";
import { HARD_LIMITS } from "@/lib/content-safety";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  session: Session;
  onBack: () => void;
}

interface Message {
  role: "user" | "character" | "system";
  content: string;
  turnIndex?: number; // index in tier_0_recent_turns (undefined = not yet persisted or system msg)
  liked?: boolean;
}

function splitOOC(text: string): { main: string; oocParts: string[] } {
  const oocParts: string[] = [];
  const main = text.replace(/\(([^)]+)\)/g, (_, inner) => {
    oocParts.push(inner.trim());
    return "";
  }).trim();
  return { main, oocParts };
}

export function ChatScreen({ work, session: initialSession, onBack }: Props) {
  const str = useStrings();
  const [session, setSession] = useState<Session>(initialSession);
  const [messages, setMessages] = useState<Message[]>(() =>
    initialSession.tier_0_recent_turns.map((t, i) => ({
      role: t.role,
      content: t.content,
      turnIndex: i,
      liked: t.liked,
    }))
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [characterName, setCharacterName] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.entities.get(session.character_id).then(entity => {
      setCharacterName(entity?.canonical_name ?? str.chat_default_char);
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
      if (updated) {
        setSession(updated);
        // Assign turnIndex to the newly completed character message
        const newTurnIndex = updated.tier_0_recent_turns.length - 1;
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], turnIndex: newTurnIndex };
          return next;
        });
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        const msg = e instanceof LlmError ? e.userMessage : str.chat_error;
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

  const handleLike = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (msg.role !== "character" || msg.turnIndex === undefined) return;

    const newLiked = !msg.liked;

    // Update local message state
    setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, liked: newLiked } : m));

    // Update liked flag on the turn in DB
    const updatedTurns = session.tier_0_recent_turns.map((t, i) =>
      i === msg.turnIndex ? { ...t, liked: newLiked } : t
    );
    await db.sessions.update(session.id, { tier_0_recent_turns: updatedTurns });
    setSession(prev => ({ ...prev, tier_0_recent_turns: updatedTurns }));

    // Update pending_voice_samples on the character
    const ext = await db.characters_extended.get(session.character_id);
    if (!ext) return;

    const lineKey = msg.content.slice(0, 300);

    if (newLiked) {
      // Find closest preceding user message for context
      let context = "";
      for (let j = msgIndex - 1; j >= 0; j--) {
        if (messages[j].role === "user") {
          const { main } = splitOOC(messages[j].content);
          context = main.slice(0, 60);
          break;
        }
      }
      const newSample: VoiceSample = { context, line: lineKey };
      await db.characters_extended.update(session.character_id, {
        pending_voice_samples: [...(ext.pending_voice_samples ?? []), newSample],
      });
    } else {
      // Remove from pending
      await db.characters_extended.update(session.character_id, {
        pending_voice_samples: (ext.pending_voice_samples ?? []).filter(s => s.line !== lineKey),
      });
    }
  };

  const remaining = HARD_LIMITS.max_input_chars - input.length;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{characterName}</p>
          <p className="text-xs text-gray-400 truncate">{work.title} · {str.chat_chapter_up_to(session.cutoff_chapter)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleNewSession} disabled={streaming}>
          {str.chat_new}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && !streaming && (
          <p className="text-center text-xs text-gray-400 mt-8">{str.chat_start_prompt(characterName)}</p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            characterName={characterName}
            onLike={m.role === "character" && m.turnIndex !== undefined && !streaming
              ? () => handleLike(i)
              : undefined
            }
            oocLabel={str.chat_ooc_label}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-200 p-3 shrink-0">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={2}
            placeholder={str.chat_placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={streaming}
          />
          {streaming
            ? <Button variant="ghost" size="sm" onClick={handleStop} className="self-end">{str.chat_stop}</Button>
            : <Button size="sm" onClick={handleSend} disabled={!input.trim()} className="self-end">{str.chat_send}</Button>
          }
        </div>
        {remaining < 200 && (
          <p className={`text-xs mt-1 ${remaining < 0 ? "text-red-500" : "text-gray-400"}`}>
            {str.chat_chars_left(remaining)}
          </p>
        )}
      </div>
    </div>
  );
}

interface BubbleProps {
  message: Message;
  characterName: string;
  onLike?: () => void;
  oocLabel: string;
}

function MessageBubble({ message, characterName, onLike, oocLabel }: BubbleProps) {
  if (message.role === "system") {
    return (
      <div className="text-center">
        <span className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{message.content}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  if (isUser) {
    const { main, oocParts } = splitOOC(message.content);
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-indigo-600 text-white">
            {main || message.content}
          </div>
          {oocParts.length > 0 && (
            <p className="text-xs text-gray-400 italic mt-0.5 text-right">
              {oocLabel} {oocParts.map(p => `(${p})`).join(" ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Character message
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <p className="text-xs text-gray-400 mb-0.5">{characterName}</p>
        <div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words bg-gray-100 text-gray-900">
          {message.content || <span className="animate-pulse">▋</span>}
        </div>
        {onLike !== undefined && (
          <button
            className={`mt-0.5 text-xs px-1.5 py-0.5 rounded transition-colors ${
              message.liked
                ? "text-indigo-500 hover:text-indigo-400"
                : "text-gray-300 hover:text-gray-500"
            }`}
            onClick={onLike}
            title={message.liked ? "👍" : "👍"}
            aria-pressed={message.liked ?? false}
          >
            👍
          </button>
        )}
      </div>
    </div>
  );
}

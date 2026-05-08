import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import { getOrCreateSkill, createBtsSession, btsChat, appendBtsTurn, listBtsSessions, generateCrewInterjection } from "@/lib/bts";
import { db } from "@/lib/storage";
import type { Work, PerformanceSession, PerformerSkill, Entity, BtsSession, BtsTurn, BtsLocation, BtsCrewMember } from "@/lib/storage";

interface Props {
  work: Work;
  performanceSession: PerformanceSession;
  onBack: () => void;
  initialSession?: BtsSession;
  initialLocation?: BtsLocation;
  initialCrew?: BtsCrewMember[];
}

interface DisplayMessage {
  role: "user" | "performer" | "crew";
  speakerName: string;
  content: string;
}

interface SkillWithEntity {
  skill: PerformerSkill;
  entity: Entity;
}

const LOCATION_LABELS: Record<BtsLocation, string> = {
  rest_area: "休憩室",
  makeup_room: "化粧室",
  set: "撮影セット",
  cafeteria: "食堂",
};

export function BtsScreen({ work, performanceSession, onBack, initialSession, initialLocation, initialCrew }: Props) {
  const [btsSession, setBtsSession] = useState<BtsSession | null>(null);
  const [skills, setSkills] = useState<SkillWithEntity[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [crewVisible, setCrewVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const characterIds = performanceSession.characters_in_scene;

      // Load skills and entities for each character
      const skillsWithEntities: SkillWithEntity[] = [];
      for (const charId of characterIds) {
        const [skill, entity] = await Promise.all([
          getOrCreateSkill(charId, work.id),
          db.entities.get(charId),
        ]);
        if (skill && entity) {
          skillsWithEntities.push({ skill, entity });
        }
      }
      setSkills(skillsWithEntities);

      if (skillsWithEntities.length > 0) {
        setSelectedSkillId(skillsWithEntities[0].skill.id);
      }

      // Use initialSession if provided, otherwise find/create
      let session: BtsSession;
      if (initialSession) {
        session = initialSession;
      } else {
        const existingSessions = await listBtsSessions(work.id);
        session = existingSessions.length > 0
          ? existingSessions[0]
          : await createBtsSession(
              work.id,
              performanceSession.characters_in_scene,
              initialLocation ?? "rest_area",
              initialCrew ?? []
            );
      }
      setBtsSession(session);

      // Map conversation history to display messages
      const displayMessages: DisplayMessage[] = session.conversation_history.map((turn: BtsTurn) => {
        if (turn.speaker_skill_id === "user") {
          return { role: "user" as const, speakerName: "あなた", content: turn.content };
        }
        if (turn.speaker_skill_id === "crew") {
          return { role: "crew" as const, speakerName: "スタッフ", content: turn.content };
        }
        const matchedSkill = skillsWithEntities.find(s => s.skill.id === turn.speaker_skill_id);
        const speakerName = matchedSkill?.entity.canonical_name ?? turn.speaker_skill_id;
        return { role: "performer" as const, speakerName, content: turn.content };
      });
      setMessages(displayMessages);
    };

    load();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const selectedSkillWithEntity = skills.find(s => s.skill.id === selectedSkillId);
  const selectedEntityName = selectedSkillWithEntity?.entity.canonical_name ?? "";

  const handleSend = async () => {
    if (!btsSession || !selectedSkillId || !input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);

    // Add user message to display
    setMessages(prev => [...prev, { role: "user", speakerName: "あなた", content: userMessage }]);
    setStreaming(true);

    // Save user turn to DB
    const userTurn: BtsTurn = {
      speaker_skill_id: "user",
      content: userMessage,
      timestamp: Date.now(),
    };
    await appendBtsTurn(btsSession.id, userTurn);

    abortRef.current = new AbortController();
    let accumulated = "";

    try {
      for await (const delta of btsChat(btsSession, selectedSkillId, userMessage, abortRef.current.signal)) {
        accumulated += delta;
        setStreamingText(accumulated);
      }

      // Save performer turn
      const performerTurn: BtsTurn = {
        speaker_skill_id: selectedSkillId,
        content: accumulated,
        timestamp: Date.now(),
      };
      await appendBtsTurn(btsSession.id, performerTurn);

      setMessages(prev => [
        ...prev,
        { role: "performer", speakerName: selectedEntityName, content: accumulated },
      ]);
      setStreamingText("");

      // Try crew interjection after performer response
      const lastExchange = `${userMessage}\n${accumulated}`;
      const crewLine = await generateCrewInterjection(btsSession, lastExchange);
      if (crewLine) {
        const crewTurn: BtsTurn = {
          speaker_skill_id: "crew",
          content: crewLine,
          timestamp: Date.now(),
        };
        await appendBtsTurn(btsSession.id, crewTurn);
        setMessages(prev => [...prev, { role: "crew", speakerName: "スタッフ", content: crewLine }]);
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        setError("エラーが発生しました。");
        setStreamingText("");
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">楽屋</p>
      </header>

      {/* Performer tabs */}
      {skills.length > 0 && (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-gray-100 shrink-0">
          {skills.map(({ skill, entity }) => (
            <button
              key={skill.id}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedSkillId === skill.id
                  ? "bg-indigo-100 text-indigo-700 font-semibold"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              onClick={() => setSelectedSkillId(skill.id)}
            >
              {entity.canonical_name}
            </button>
          ))}
        </div>
      )}

      {/* Crew section (collapsible) */}
      {btsSession && btsSession.present_crew.length > 0 && (
        <div className="border-b border-gray-100 shrink-0">
          <button
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            onClick={() => setCrewVisible(v => !v)}
          >
            <span>スタッフ ({btsSession.present_crew.length}名)</span>
            <span>{crewVisible ? "▲" : "▼"}</span>
          </button>
          {crewVisible && (
            <div className="px-3 pb-2 space-y-0.5">
              {btsSession.present_crew.map((m, i) => (
                <p key={i} className="text-xs text-gray-400">
                  <span className="font-medium">{m.name}</span>（{m.role}）— {m.persona_snippet}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status line */}
      <div className="px-3 py-1.5 border-b border-gray-100 shrink-0">
        <p className="text-xs text-gray-400">
          {LOCATION_LABELS[btsSession?.location ?? "rest_area"]}{selectedEntityName ? ` · ${selectedEntityName} と話す` : ""}
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streamingText && (
          <p className="text-center text-xs text-gray-400 mt-8">
            楽屋でキャラクターと話しましょう。
          </p>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {streamingText && (
          <PerformerBubble name={selectedEntityName} content={streamingText} streaming />
        )}
        {error && (
          <div className="text-center">
            <span className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">{error}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="border-t border-gray-200 p-3 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="メッセージを入力..."
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="self-end"
          >
            送信
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "crew") return <CrewBubble content={message.content} />;
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className="rounded-tl-xl rounded-bl-xl rounded-br-xl px-3 py-2 text-sm whitespace-pre-wrap break-words bg-indigo-500 text-white">
            {message.content}
          </div>
        </div>
      </div>
    );
  }
  return <PerformerBubble name={message.speakerName} content={message.content} />;
}

function PerformerBubble({ name, content, streaming }: { name: string; content: string; streaming?: boolean }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {name && <p className="text-xs text-gray-400 mb-0.5">{name}</p>}
        <div className="rounded-tr-xl rounded-br-xl rounded-bl-xl px-3 py-2 text-sm whitespace-pre-wrap break-words bg-white/80 text-gray-800">
          {content || (streaming && <span className="animate-pulse">▋</span>)}
        </div>
      </div>
    </div>
  );
}

function CrewBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-center my-1">
      <p className="text-xs text-gray-400 italic bg-gray-50 rounded px-2 py-1 max-w-[90%]">
        {content}
      </p>
    </div>
  );
}

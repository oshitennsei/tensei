import { useState, useRef, useEffect } from "react";
import { Button } from "../components/Button";
import {
  getOrCreateSkill, createBtsSession, btsGroupChat, appendBtsTurn,
  listBtsSessions, generateCrewInterjection, generateAmbientEvent,
  type SkillWithEntity,
} from "@/lib/bts";
import { db } from "@/lib/storage";
import type { Work, PerformanceSession, BtsSession, BtsTurn, BtsLocation, BtsCrewMember } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  performanceSession: PerformanceSession;
  onBack: () => void;
  initialSession?: BtsSession;
  initialLocation?: BtsLocation;
  initialCrew?: BtsCrewMember[];
}

interface DisplayMessage {
  role: "user" | "performer" | "crew" | "ambient";
  speakerName: string;
  content: string;
  turn_type?: "dialogue" | "action";
}

export function BtsScreen({ work, performanceSession, onBack, initialSession, initialLocation, initialCrew }: Props) {
  const str = useStrings();
  const [btsSession, setBtsSession] = useState<BtsSession | null>(null);
  const [skills, setSkills] = useState<SkillWithEntity[]>([]);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pendingBubbles, setPendingBubbles] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crewVisible, setCrewVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const locationLabel = (loc: BtsLocation): string => {
    if (loc === "rest_area")   return str.bts_loc_rest_label;
    if (loc === "makeup_room") return str.bts_loc_makeup_label;
    if (loc === "set")         return str.bts_loc_set_label;
    if (loc === "cafeteria")   return str.bts_loc_cafeteria_label;
    return loc;
  };

  useEffect(() => {
    const load = async () => {
      const characterIds = performanceSession.characters_in_scene;
      const skillsWithEntities: SkillWithEntity[] = [];
      for (const charId of characterIds) {
        const [skill, entity] = await Promise.all([
          getOrCreateSkill(charId, work.id),
          db.entities.get(charId),
        ]);
        if (skill && entity) skillsWithEntities.push({ skill, entity });
      }
      setSkills(skillsWithEntities);

      let session: BtsSession;
      if (initialSession) {
        session = initialSession;
      } else {
        const existing = await listBtsSessions(work.id);
        session = existing.length > 0
          ? existing[0]
          : await createBtsSession(work.id, characterIds, initialLocation ?? "rest_area", initialCrew ?? []);
      }
      setBtsSession(session);

      const displayMessages: DisplayMessage[] = session.conversation_history.map((turn: BtsTurn) => {
        if (turn.speaker_skill_id === "user") {
          return { role: "user" as const, speakerName: str.bts_you, content: turn.content };
        }
        if (turn.speaker_skill_id === "crew") {
          return { role: "crew" as const, speakerName: str.bts_staff, content: turn.content };
        }
        if (turn.speaker_skill_id === "ambient") {
          return { role: "ambient" as const, speakerName: "", content: turn.content };
        }
        const matched = skillsWithEntities.find(s => s.skill.id === turn.speaker_skill_id);
        return {
          role: "performer" as const,
          speakerName: matched?.entity.canonical_name ?? turn.speaker_skill_id,
          content: turn.content,
          turn_type: turn.turn_type,
        };
      });
      setMessages(displayMessages);
    };
    load();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingBubbles]);

  const handleSend = async () => {
    if (!btsSession || !input.trim() || streaming || skills.length === 0) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);
    setPendingBubbles([]);

    setMessages(prev => [...prev, { role: "user", speakerName: str.bts_you, content: userMessage }]);
    setStreaming(true);

    await appendBtsTurn(btsSession.id, { speaker_skill_id: "user", content: userMessage, timestamp: Date.now() });

    abortRef.current = new AbortController();
    const completedTurns: BtsTurn[] = [];

    try {
      for await (const chunk of btsGroupChat(btsSession, skills, userMessage, abortRef.current.signal)) {
        if (chunk.event === "turn_done") {
          const { turn } = chunk;
          const bubble: DisplayMessage = {
            role: "performer",
            speakerName: turn.speaker_name,
            content: turn.content,
            turn_type: turn.turn_type,
          };
          // Move from pending to committed as each turn arrives
          setPendingBubbles(prev => [...prev, bubble]);

          const dbTurn: BtsTurn = {
            speaker_skill_id: turn.speaker_skill_id,
            content: turn.content,
            timestamp: Date.now(),
            turn_type: turn.turn_type,
          };
          await appendBtsTurn(btsSession.id, dbTurn);
          completedTurns.push(dbTurn);
        } else if (chunk.event === "all_done") {
          // Commit all pending bubbles to main messages list
          setPendingBubbles([]);
          setMessages(prev => [
            ...prev,
            ...completedTurns.map(t => {
              const matched = skills.find(s => s.skill.id === t.speaker_skill_id);
              return {
                role: "performer" as const,
                speakerName: matched?.entity.canonical_name ?? t.speaker_skill_id,
                content: t.content,
                turn_type: t.turn_type,
              };
            }),
          ]);

          // Crew interjection or ambient event (mutually exclusive, low probability)
          const lastExchange = `${userMessage}\n${completedTurns.map(t => t.content).join("\n")}`;
          const crewLine = await generateCrewInterjection(btsSession, lastExchange);
          if (crewLine) {
            const crewTurn: BtsTurn = { speaker_skill_id: "crew", content: crewLine, timestamp: Date.now() };
            await appendBtsTurn(btsSession.id, crewTurn);
            setMessages(prev => [...prev, { role: "crew", speakerName: str.bts_staff, content: crewLine }]);
          } else {
            // Only roll for ambient if crew didn't interject
            const ambientLine = await generateAmbientEvent(btsSession);
            if (ambientLine) {
              const ambientTurn: BtsTurn = { speaker_skill_id: "ambient", content: ambientLine, timestamp: Date.now() };
              await appendBtsTurn(btsSession.id, ambientTurn);
              setMessages(prev => [...prev, { role: "ambient", speakerName: "", content: ambientLine }]);
            }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") {
        setError(str.bts_error);
        setPendingBubbles([]);
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">{str.bts_title}</p>
      </header>

      {/* Performers present (display only) */}
      {skills.length > 0 && (
        <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-gray-100 shrink-0">
          {skills.map(({ skill, entity }) => (
            <span
              key={skill.id}
              className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
            >
              {entity.canonical_name}
            </span>
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
            <span>{str.bts_crew_label(btsSession.present_crew.length)}</span>
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
        <p className="text-xs text-gray-400">{locationLabel(btsSession?.location ?? "rest_area")}</p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && pendingBubbles.length === 0 && !streaming && (
          <p className="text-center text-xs text-gray-400 mt-8">{str.bts_empty}</p>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
        {pendingBubbles.map((msg, i) => <MessageBubble key={`p${i}`} message={msg} />)}
        {streaming && pendingBubbles.length === 0 && (
          <div className="flex justify-start">
            <div className="rounded-tr-xl rounded-br-xl rounded-bl-xl px-3 py-2 text-sm bg-white/80 text-gray-400 animate-pulse">▋</div>
          </div>
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
          <textarea
            rows={2}
            placeholder={str.bts_placeholder}
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim()} className="self-end">
            {str.bts_send}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "ambient") return <AmbientBubble content={message.content} />;
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
  return <PerformerBubble name={message.speakerName} content={message.content} turnType={message.turn_type} />;
}

function PerformerBubble({ name, content, turnType }: { name: string; content: string; turnType?: "dialogue" | "action" }) {
  const isAction = turnType === "action";
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {name && <p className="text-xs text-gray-400 mb-0.5">{name}</p>}
        <div className={`rounded-tr-xl rounded-br-xl rounded-bl-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isAction
            ? "bg-gray-50 text-gray-500 italic border border-gray-100"
            : "bg-white/80 text-gray-800"
        }`}>
          {isAction ? `*${content}*` : content}
        </div>
      </div>
    </div>
  );
}

function CrewBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-center my-1">
      <p className="text-xs text-gray-400 italic bg-gray-50 rounded px-2 py-1 max-w-[90%]">{content}</p>
    </div>
  );
}

function AmbientBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-center my-2">
      <p className="text-[11px] text-gray-300 italic text-center max-w-[85%] leading-relaxed">— {content} —</p>
    </div>
  );
}

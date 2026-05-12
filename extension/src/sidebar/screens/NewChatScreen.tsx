import { useState, useEffect, useMemo } from "react";
import { Button } from "../components/Button";
import { createNewSession } from "@/lib/memory";
import { listChapters } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Entity, Session, CharacterExtended } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  onBack: () => void;
  onStart: (session: Session) => void;
}

export function NewChatScreen({ work, onBack, onStart }: Props) {
  const str = useStrings();
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [selectedChar, setSelectedChar] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<string>("base");
  const [charExt, setCharExt] = useState<CharacterExtended | null>(null);
  const [cutoff, setCutoff] = useState(1);
  const [maxChapter, setMaxChapter] = useState(1);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([
      db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
      listChapters(work.id),
    ]).then(([chars, chapters]) => {
      setCharacters(chars);
      const max = chapters.reduce((m, c) => Math.max(m, c.chapter_number), 1);
      setMaxChapter(max);
      setCutoff(max);
    });
  }, [work.id]);

  useEffect(() => {
    if (!selectedChar) { setCharExt(null); return; }
    db.characters_extended.get(selectedChar).then(ext => {
      setCharExt(ext ?? null);
      setSelectedVersion("base");
    });
  }, [selectedChar]);

  const visibleChars = useMemo(() =>
    characters.filter(c => c.first_appearance == null || c.first_appearance <= cutoff),
    [characters, cutoff]
  );

  useEffect(() => {
    if (visibleChars.length === 0) { setSelectedChar(""); return; }
    if (!visibleChars.find(c => c.id === selectedChar)) {
      setSelectedChar(visibleChars[0].id);
    }
  }, [visibleChars]);

  const selectableSnapshots = useMemo(() =>
    charExt?.state_snapshots.filter(s => s.is_selectable) ?? [],
    [charExt]
  );

  const handleStart = async () => {
    if (!selectedChar || starting) return;
    setStarting(true);
    const versionId = selectedVersion === "base" ? undefined : selectedVersion;
    const session = await createNewSession(work.id, selectedChar, cutoff, "reader", versionId);
    onStart(session);
  };

  const noChars = characters.length === 0;
  const noneInRange = !noChars && visibleChars.length === 0;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold">{str.new_chat_title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <p className="text-xs text-gray-400">{str.new_chat_desc(work.title)}</p>

        {/* Cutoff first — affects character list */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {str.new_chat_cutoff(cutoff)}
          </label>
          <input
            type="range" min={1} max={maxChapter} value={cutoff}
            className="w-full accent-indigo-600"
            onChange={e => setCutoff(Number(e.target.value))}
          />
          <p className="text-xs text-gray-400 mt-1">
            {str.new_chat_cutoff_desc}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{str.new_chat_char_label}</label>
          {noChars && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">
              {str.new_chat_no_chars}
            </p>
          )}
          {noneInRange && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              {str.new_chat_none_range(cutoff)}
            </p>
          )}
          {visibleChars.length > 0 && (
            <div className="space-y-1.5">
              {visibleChars.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChar(c.id)}
                  className={`w-full text-left px-3 py-2.5 rounded border text-sm transition-colors ${
                    selectedChar === c.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium">{c.canonical_name}</p>
                  {c.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{c.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">{str.new_chat_first_appear(c.first_appearance ?? "?")}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Version picker — only shown when selectable snapshots exist */}
        {selectableSnapshots.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{str.new_chat_version_label}</label>
            <div className="space-y-1.5">
              <button
                onClick={() => setSelectedVersion("base")}
                className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                  selectedVersion === "base"
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <p className="font-medium">{str.new_chat_base_label}</p>
                <p className="text-xs text-gray-400">{str.new_chat_base_desc}</p>
              </button>
              {selectableSnapshots.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedVersion(s.id ?? "base")}
                  className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                    selectedVersion === s.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="font-medium">{s.label ?? str.new_chat_snapshot}</p>
                  <div className="flex gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                    {s.character_age && <span>{s.character_age}</span>}
                    {s.from_chapter != null && <span>{str.new_chat_chapter_around(s.from_chapter)}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          className="w-full"
          disabled={!selectedChar || starting}
          onClick={handleStart}
        >
          {starting ? str.new_chat_starting : str.new_chat_start}
        </Button>
      </div>
    </div>
  );
}

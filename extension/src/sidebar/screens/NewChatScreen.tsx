import { useState, useEffect, useMemo } from "react";
import { Button } from "../components/Button";
import { createNewSession } from "@/lib/memory";
import { listChapters } from "@/lib/ingestion";
import { db } from "@/lib/storage";
import type { Work, Entity, Session, CharacterExtended } from "@/lib/storage";

interface Props {
  work: Work;
  onBack: () => void;
  onStart: (session: Session) => void;
}

export function NewChatScreen({ work, onBack, onStart }: Props) {
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
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold">新しいチャット</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <p className="text-xs text-gray-400">「{work.title}」のキャラクターと話す設定をしてください。</p>

        {/* Cutoff first — affects character list */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            既読章（ネタバレ制限）: 第 {cutoff} 章まで
          </label>
          <input
            type="range" min={1} max={maxChapter} value={cutoff}
            className="w-full accent-indigo-600"
            onChange={e => setCutoff(Number(e.target.value))}
          />
          <p className="text-xs text-gray-400 mt-1">
            選択した章より後の出来事はキャラクターが知りません。
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">キャラクター</label>
          {noChars && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">
              キャラクターがまだ登録されていません。テキストを取り込んで解析してください。
            </p>
          )}
          {noneInRange && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              第 {cutoff} 章までに登場するキャラクターがいません。章数を増やしてください。
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
                  <p className="text-xs text-gray-400 mt-0.5">初登場: 第{c.first_appearance ?? "?"}章</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Version picker — only shown when selectable snapshots exist */}
        {selectableSnapshots.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">人格バージョン</label>
            <div className="space-y-1.5">
              <button
                onClick={() => setSelectedVersion("base")}
                className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors ${
                  selectedVersion === "base"
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <p className="font-medium">現在（ベース）</p>
                <p className="text-xs text-gray-400">デフォルトの人格設定</p>
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
                  <p className="font-medium">{s.label ?? `スナップショット`}</p>
                  <div className="flex gap-2 text-xs text-gray-400 mt-0.5 flex-wrap">
                    {s.character_age && <span>{s.character_age}</span>}
                    {s.from_chapter != null && <span>第{s.from_chapter}章頃</span>}
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
          {starting ? "準備中..." : "チャット開始"}
        </Button>
      </div>
    </div>
  );
}

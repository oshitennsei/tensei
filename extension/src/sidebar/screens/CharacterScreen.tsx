import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import { db } from "@/lib/storage";
import type { Work, Entity, CharacterExtended, GlossaryEntry } from "@/lib/storage";

interface Props {
  work: Work;
  onBack: () => void;
  onEdit: (character_id: string) => void;
  onAdd: () => void;
}

export function CharacterScreen({ work, onBack, onEdit, onAdd }: Props) {
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [extIds, setExtIds] = useState<Set<string>>(new Set());
  const [authorProvidedIds, setAuthorProvidedIds] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState("");
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [chars, exts] = await Promise.all([
      db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
      db.characters_extended.where("work_id").equals(work.id).toArray(),
    ]);
    setCharacters(chars.sort((a, b) => (a.first_appearance ?? 99) - (b.first_appearance ?? 99)));
    setExtIds(new Set(exts.map(e => e.id)));
    setAuthorProvidedIds(new Set(exts.filter(e => e.author_provided).map(e => e.id)));
  };

  useEffect(() => { reload(); }, [work.id]);

  const handleDelete = async (id: string) => {
    if (!confirm("このキャラクターを削除しますか？")) return;
    await db.transaction("rw", [db.entities, db.characters_extended], async () => {
      await db.entities.delete(id);
      await db.characters_extended.delete(id);
    });
    reload();
  };

  const importFromJson = async (json: Record<string, unknown>) => {
    const name = String(json.canonical_name ?? "").trim();
    if (!name) { setImportError("canonical_name が見つかりません。"); return; }

    // Find or create Entity
    const existing = await db.entities
      .where("work_id").equals(work.id)
      .filter(e => e.canonical_name === name)
      .first();

    const entity_id = existing?.id ?? crypto.randomUUID();
    const entity: Entity = {
      id: entity_id,
      work_id: work.id,
      type: "character",
      canonical_name: name,
      aliases: (json.aliases as string[]) ?? [],
      description: String(json.description ?? ""),
      parent_entities: [],
      child_entities: [],
      first_appearance: (json.first_appearance as number) ?? undefined,
      key_appearances: [],
      linked_entities: [],
    };

    const ext: CharacterExtended = {
      id: entity_id,
      work_id: work.id,
      persona: String(json.persona ?? ""),
      speech_style: String(json.speech_style ?? "") || undefined,
      voice_samples: (json.voice_samples as CharacterExtended["voice_samples"]) ?? [],
      will_do: (json.will_do as string[]) ?? [],
      will_not_do: (json.will_not_do as string[]) ?? [],
      forbidden_topics: (json.forbidden_topics as string[]) ?? [],
      dialogue_examples: (json.dialogue_examples as CharacterExtended["dialogue_examples"]) ?? [],
      state_snapshots: (json.state_snapshots as CharacterExtended["state_snapshots"]) ?? [],
      locked_fields: (json.locked_fields as CharacterExtended["locked_fields"]) ?? [],
      author_provided: true,
    };

    await db.transaction("rw", [db.entities, db.characters_extended, db.work_glossaries], async () => {
      if (existing) {
        await db.entities.put(entity);
        await db.characters_extended.put(ext);
      } else {
        await db.entities.add(entity);
        const extExists = await db.characters_extended.get(entity_id);
        if (extExists) await db.characters_extended.put(ext);
        else await db.characters_extended.add(ext);
      }

      if (json.glossary && Array.isArray(json.glossary)) {
        const entries = json.glossary as GlossaryEntry[];
        const existingGlossary = await db.work_glossaries.get(work.id);
        if (existingGlossary) {
          // merge: update existing entries, add new ones
          const merged = [...existingGlossary.entries];
          for (const e of entries) {
            const idx = merged.findIndex(x => x.original === e.original);
            if (idx >= 0) merged[idx] = e;
            else merged.push(e);
          }
          await db.work_glossaries.put({ ...existingGlossary, entries: merged });
        } else {
          await db.work_glossaries.add({ id: work.id, work_id: work.id, entries });
        }
      }
    });

    setImportOk(`「${name}」をインポートしました。`);
    reload();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(""); setImportOk("");
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setImportError("JSONの解析に失敗しました。"); return;
    }

    await importFromJson(json);
  };

  const handleUrlImport = async () => {
    setImportError(""); setImportOk("");
    const url = urlInput.trim();
    if (!url) return;
    setUrlImporting(true);
    try {
      const res = await fetch(url);
      if (!res.ok) { setImportError(`取得に失敗しました: ${res.status}`); return; }
      let json: Record<string, unknown>;
      try {
        json = await res.json();
      } catch {
        setImportError("JSONの解析に失敗しました。"); return;
      }
      await importFromJson(json);
      setUrlInput("");
      setShowUrlImport(false);
    } catch (err) {
      setImportError(`取得エラー: ${String(err)}`);
    } finally {
      setUrlImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold flex-1">キャラクター管理</h2>
        <Button variant="ghost" size="sm" onClick={() => setShowUrlImport(p => !p)}>URL読込</Button>
        <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>JSON読込</Button>
        <Button size="sm" onClick={onAdd}>+ 追加</Button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      </header>

      {showUrlImport && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50">
          <input
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs"
            placeholder="GitHub raw URL"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleUrlImport(); }}
          />
          <Button size="sm" onClick={handleUrlImport} disabled={urlImporting || !urlInput.trim()}>
            {urlImporting ? "読込中..." : "読み込み"}
          </Button>
        </div>
      )}

      {(importError || importOk) && (
        <div className={`mx-4 mt-2 px-3 py-1.5 rounded text-xs ${importError ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          {importError || importOk}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {characters.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-12 px-4 space-y-2">
            <p>キャラクターがまだいません。</p>
            <p className="text-xs">テキストを取り込んで解析するか、手動で追加してください。</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {characters.map(c => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold shrink-0">
                  {c.canonical_name.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.canonical_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {c.first_appearance != null && (
                      <span className="text-xs text-gray-400">第{c.first_appearance}章〜</span>
                    )}
                    {!extIds.has(c.id) && (
                      <span className="text-xs text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">
                        ペルソナ未設定
                      </span>
                    )}
                    {authorProvidedIds.has(c.id) && (
                      <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">公式</span>
                    )}
                  </div>
                  {c.description && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{c.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(c.id)}>編集</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(c.id)}>削除</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

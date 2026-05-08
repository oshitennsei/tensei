import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { db } from "@/lib/storage";
import type { Work, Entity, CharacterExtended, CharacterStateSnapshot, LockedField, VoiceSample, PerformerSkill } from "@/lib/storage";
import { getOrCreateSkill, regenerateSkill, saveSkillField } from "@/lib/bts";

interface Props {
  work: Work;
  character_id: string | null;
  onBack: () => void;
  onSaved: () => void;
}

const BLANK_ENTITY = { canonical_name: "", aliases: "", description: "" };
const BLANK_EXT = { persona: "", speech_style: "", will_do: "", will_not_do: "", forbidden_topics: "" };
const LOCKABLE: { key: LockedField; label: string }[] = [
  { key: "persona", label: "ペルソナ" },
  { key: "speech_style", label: "話し方" },
  { key: "will_not_do", label: "しないこと" },
  { key: "forbidden_topics", label: "禁止トピック" },
];

function splitLines(s: string): string[] {
  return s.split("\n").map(l => l.trim()).filter(Boolean);
}

function buildExportJson(entity: Entity, ext: CharacterExtended): string {
  return JSON.stringify({
    version: "1.0",
    schema: "https://raw.githubusercontent.com/Chakotay-Lee/tensei-authors/main/schemas/character-config.schema.json",
    canonical_name: entity.canonical_name,
    aliases: entity.aliases,
    description: entity.description,
    first_appearance: entity.first_appearance,
    persona: ext.persona,
    speech_style: ext.speech_style ?? "",
    will_do: ext.will_do,
    will_not_do: ext.will_not_do,
    forbidden_topics: ext.forbidden_topics,
    locked_fields: ext.locked_fields ?? [],
    voice_samples: ext.voice_samples,
    dialogue_examples: ext.dialogue_examples ?? [],
    state_snapshots: ext.state_snapshots,
    author_provided: true,
  }, null, 2);
}

export function CharacterEditScreen({ work, character_id, onBack, onSaved }: Props) {
  const [entityForm, setEntityForm] = useState(BLANK_ENTITY);
  const [extForm, setExtForm] = useState(BLANK_EXT);
  const [lockedFields, setLockedFields] = useState<LockedField[]>([]);
  const [authorProvided, setAuthorProvided] = useState(false);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [newSample, setNewSample] = useState<{ context: string; line: string }>({ context: "", line: "" });
  const [dialogueExamples, setDialogueExamples] = useState<NonNullable<CharacterExtended["dialogue_examples"]>>([]);
  const [showExForm, setShowExForm] = useState(false);
  const [newEx, setNewEx] = useState({ context: "", user_message_pattern: "", ideal_response: "" });
  const [snapshots, setSnapshots] = useState<CharacterStateSnapshot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "limits" | "versions" | "performer">("basic");

  // Performer skill state
  const [skill, setSkill] = useState<PerformerSkill | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillGenerating, setSkillGenerating] = useState(false);
  const [newQuirk, setNewQuirk] = useState("");
  const [newInterest, setNewInterest] = useState("");

  // For snapshot editing
  const [editingSnap, setEditingSnap] = useState<CharacterStateSnapshot | null>(null);
  const [snapForm, setSnapForm] = useState({
    label: "", character_age: "", from_chapter: "", is_selectable: true,
    persona_override: "", speech_style_override: "", change_reason: "",
  });

  useEffect(() => {
    if (!character_id) return;
    (async () => {
      const [entity, ext] = await Promise.all([
        db.entities.get(character_id),
        db.characters_extended.get(character_id),
      ]);
      if (entity) setEntityForm({ canonical_name: entity.canonical_name, aliases: entity.aliases.join(", "), description: entity.description });
      if (ext) {
        setExtForm({ persona: ext.persona, speech_style: ext.speech_style ?? "", will_do: (ext.will_do ?? []).join("\n"), will_not_do: ext.will_not_do.join("\n"), forbidden_topics: ext.forbidden_topics.join("\n") });
        setLockedFields(ext.locked_fields ?? []);
        setAuthorProvided(ext.author_provided ?? false);
        setVoiceSamples(ext.voice_samples ?? []);
        setDialogueExamples(ext.dialogue_examples ?? []);
        setSnapshots(ext.state_snapshots ?? []);
      }
    })();
  }, [character_id]);

  useEffect(() => {
    if (activeTab !== "performer" || !character_id) return;
    setSkillLoading(true);
    db.performer_skills.get(character_id).then(s => {
      setSkill(s ?? null);
      setSkillLoading(false);
    });
  }, [activeTab, character_id]);

  const handleGenerateSkill = async () => {
    if (!character_id) return;
    setSkillGenerating(true);
    try {
      const s = await getOrCreateSkill(character_id, work.id);
      setSkill(s);
    } finally {
      setSkillGenerating(false);
    }
  };

  const handleRegenerateSkill = async () => {
    if (!character_id) return;
    setSkillGenerating(true);
    try {
      const s = await regenerateSkill(character_id, work.id);
      setSkill(s);
    } finally {
      setSkillGenerating(false);
    }
  };

  const updateSkillLocal = (updates: Partial<PerformerSkill>) => {
    setSkill(prev => prev ? { ...prev, ...updates } : prev);
  };

  const persistSkill = async (updates: Partial<PerformerSkill>) => {
    if (!character_id) return;
    await saveSkillField(character_id, updates);
  };

  const addQuirk = async () => {
    if (!skill || !newQuirk.trim()) return;
    const quirks = [...skill.off_set_persona.quirks, newQuirk.trim()];
    const off_set_persona = { ...skill.off_set_persona, quirks };
    updateSkillLocal({ off_set_persona });
    await persistSkill({ off_set_persona });
    setNewQuirk("");
  };

  const removeQuirk = async (i: number) => {
    if (!skill) return;
    const quirks = skill.off_set_persona.quirks.filter((_, idx) => idx !== i);
    const off_set_persona = { ...skill.off_set_persona, quirks };
    updateSkillLocal({ off_set_persona });
    await persistSkill({ off_set_persona });
  };

  const addInterest = async () => {
    if (!skill || !newInterest.trim()) return;
    const off_set_interests = [...skill.off_set_interests, newInterest.trim()];
    updateSkillLocal({ off_set_interests });
    await persistSkill({ off_set_interests });
    setNewInterest("");
  };

  const removeInterest = async (i: number) => {
    if (!skill) return;
    const off_set_interests = skill.off_set_interests.filter((_, idx) => idx !== i);
    updateSkillLocal({ off_set_interests });
    await persistSkill({ off_set_interests });
  };

  const toggleLock = (field: LockedField) => {
    setLockedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  };

  const handleSave = async () => {
    if (!entityForm.canonical_name.trim()) { setError("キャラクター名を入力してください。"); return; }
    setSaving(true); setError("");
    try {
      const aliases = entityForm.aliases.split(",").map(s => s.trim()).filter(Boolean);
      if (character_id) {
        await db.entities.update(character_id, { canonical_name: entityForm.canonical_name.trim(), aliases, description: entityForm.description.trim() });
        const extExists = await db.characters_extended.get(character_id);
        const extData: CharacterExtended = {
          id: character_id, work_id: work.id,
          persona: extForm.persona.trim(),
          speech_style: extForm.speech_style.trim() || undefined,
          voice_samples: voiceSamples,
          will_do: splitLines(extForm.will_do),
          will_not_do: splitLines(extForm.will_not_do),
          forbidden_topics: splitLines(extForm.forbidden_topics),
          dialogue_examples: dialogueExamples,
          state_snapshots: snapshots,
          locked_fields: lockedFields,
          author_provided: extExists?.author_provided ?? false,
        };
        if (extExists) await db.characters_extended.put(extData);
        else await db.characters_extended.add(extData);
      } else {
        const id = crypto.randomUUID();
        const entity: Entity = { id, work_id: work.id, type: "character", canonical_name: entityForm.canonical_name.trim(), aliases, description: entityForm.description.trim(), parent_entities: [], child_entities: [], key_appearances: [], linked_entities: [] };
        await db.entities.add(entity);
        await db.characters_extended.add({ id, work_id: work.id, persona: extForm.persona.trim(), speech_style: extForm.speech_style.trim() || undefined, voice_samples: [], will_do: splitLines(extForm.will_do), will_not_do: splitLines(extForm.will_not_do), forbidden_topics: splitLines(extForm.forbidden_topics), dialogue_examples: dialogueExamples, state_snapshots: snapshots, locked_fields: lockedFields, author_provided: false });
      }
      onSaved();
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  };

  const handleExport = async () => {
    if (!character_id) return;
    const [entity, ext] = await Promise.all([db.entities.get(character_id), db.characters_extended.get(character_id)]);
    if (!entity || !ext) return;
    const json = buildExportJson(entity, ext);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity.canonical_name.replace(/\s+/g, "_")}.tensei.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Snapshot management
  const startNewSnap = () => {
    setEditingSnap(null);
    setSnapForm({ label: "", character_age: "", from_chapter: "", is_selectable: true, persona_override: "", speech_style_override: "", change_reason: "" });
  };

  const startEditSnap = (s: CharacterStateSnapshot) => {
    setEditingSnap(s);
    setSnapForm({
      label: s.label ?? "",
      character_age: s.character_age ?? "",
      from_chapter: s.from_chapter != null ? String(s.from_chapter) : "",
      is_selectable: s.is_selectable ?? true,
      persona_override: s.persona_override ?? "",
      speech_style_override: s.speech_style_override ?? "",
      change_reason: s.change_reason ?? "",
    });
  };

  const saveSnap = () => {
    const snap: CharacterStateSnapshot = {
      id: editingSnap?.id ?? crypto.randomUUID(),
      label: snapForm.label || "バージョン",
      character_age: snapForm.character_age || undefined,
      from_chapter: snapForm.from_chapter !== "" ? Number(snapForm.from_chapter) : null,
      is_selectable: snapForm.is_selectable,
      persona_override: snapForm.persona_override || undefined,
      speech_style_override: snapForm.speech_style_override || undefined,
      change_reason: snapForm.change_reason || undefined,
      at_chapter: snapForm.from_chapter !== "" ? Number(snapForm.from_chapter) : 0,
      knowledge: editingSnap?.knowledge ?? [],
      emotional_state: editingSnap?.emotional_state ?? "",
      relationships: editingSnap?.relationships ?? {},
    };
    if (editingSnap) {
      setSnapshots(prev => prev.map(s => s.id === editingSnap.id ? snap : s));
    } else {
      setSnapshots(prev => [...prev, snap]);
    }
    setEditingSnap(undefined as never);
    setSnapForm({ label: "", character_age: "", from_chapter: "", is_selectable: true, persona_override: "", speech_style_override: "", change_reason: "" });
  };

  const deleteSnap = (id: string) => setSnapshots(prev => prev.filter(s => s.id !== id));

  const isLocked = (field: LockedField) => authorProvided && lockedFields.includes(field);

  const addVoiceSample = () => {
    if (!newSample.line.trim()) return;
    setVoiceSamples(prev => [...prev, { context: newSample.context.trim(), line: newSample.line.trim() }]);
    setNewSample({ context: "", line: "" });
  };

  const removeVoiceSample = (i: number) =>
    setVoiceSamples(prev => prev.filter((_, idx) => idx !== i));

  const addDialogueExample = () => {
    if (!newEx.user_message_pattern.trim() || !newEx.ideal_response.trim()) return;
    setDialogueExamples(prev => [...prev, {
      context: newEx.context.trim(),
      user_message_pattern: newEx.user_message_pattern.trim(),
      ideal_response: newEx.ideal_response.trim(),
    }]);
    setNewEx({ context: "", user_message_pattern: "", ideal_response: "" });
    setShowExForm(false);
  };

  const removeDialogueExample = (i: number) =>
    setDialogueExamples(prev => prev.filter((_, idx) => idx !== i));

  const isNew = character_id === null;
  const isSnapEditing = snapForm.label !== "" || editingSnap !== null;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold flex-1">{isNew ? "キャラクターを追加" : "キャラクターを編集"}</h2>
        {character_id && (
          <Button variant="ghost" size="sm" onClick={handleExport}>JSON書出</Button>
        )}
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 shrink-0 text-xs">
        {(["basic", "limits", "versions", ...(character_id ? ["performer"] : [])] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`flex-1 py-2 ${activeTab === tab ? "border-b-2 border-indigo-500 text-indigo-700 font-medium" : "text-gray-500 hover:text-gray-700"}`}
          >
            {tab === "basic" ? "基本・ペルソナ" : tab === "limits" ? "制限" : tab === "versions" ? "成長・変化" : "演者"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {activeTab === "basic" && (
          <>
            <div>
              <label className="block text-xs text-gray-600 mb-1">キャラクター名 *</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="例: 鈴木太郎" value={entityForm.canonical_name} onChange={e => setEntityForm(f => ({ ...f, canonical_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">別名・あだ名（カンマ区切り）</label>
              <input className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="例: タロウ, 太郎くん" value={entityForm.aliases} onChange={e => setEntityForm(f => ({ ...f, aliases: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">簡単な説明</label>
              <textarea className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none" rows={2} value={entityForm.description} onChange={e => setEntityForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">ペルソナ</label>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" className="accent-indigo-600" checked={lockedFields.includes("persona")} onChange={() => toggleLock("persona")} disabled={isLocked("persona")} />
                  {isLocked("persona") ? "🔒 変更不可（著者設定）" : "🔒 変更不可"}
                </label>
              </div>
              <textarea
                className={`w-full border rounded px-2 py-1.5 text-sm resize-none ${isLocked("persona") ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300"}`}
                rows={6}
                placeholder={"例:\nあなたは鈴木太郎です。17歳の高校2年生で..."}
                value={extForm.persona}
                onChange={e => setExtForm(f => ({ ...f, persona: e.target.value }))}
                disabled={isLocked("persona")}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">話し方の特徴</label>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" className="accent-indigo-600" checked={lockedFields.includes("speech_style")} onChange={() => toggleLock("speech_style")} disabled={isLocked("speech_style")} />
                  {isLocked("speech_style") ? "🔒 変更不可（著者設定）" : "🔒 変更不可"}
                </label>
              </div>
              <textarea
                className={`w-full border rounded px-2 py-1.5 text-sm resize-none ${isLocked("speech_style") ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300"}`}
                rows={2}
                placeholder="例: 砕けた口調。語尾に「〜だぜ」を使う。"
                value={extForm.speech_style}
                onChange={e => setExtForm(f => ({ ...f, speech_style: e.target.value }))}
                disabled={isLocked("speech_style")}
              />
            </div>

            {/* Voice samples */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                会話サンプル
                <span className="text-gray-400 ml-1">（キャラの口調・セリフ例をLLMに示す）</span>
              </label>
              {voiceSamples.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {voiceSamples.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs bg-gray-50 rounded px-2 py-1.5">
                      <div className="flex-1 min-w-0">
                        {s.context && <p className="text-gray-400 truncate">【{s.context}】</p>}
                        <p className="text-gray-700">「{s.line}」</p>
                      </div>
                      <button className="text-gray-300 hover:text-red-500 shrink-0 leading-none" onClick={() => removeVoiceSample(i)}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-1">
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                  placeholder="状況・文脈（任意）例: 友人に挨拶するとき"
                  value={newSample.context}
                  onChange={e => setNewSample(s => ({ ...s, context: e.target.value }))}
                />
                <div className="flex gap-1">
                  <input
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs"
                    placeholder="セリフ例（必須）例: よぉ、元気か？"
                    value={newSample.line}
                    onChange={e => setNewSample(s => ({ ...s, line: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addVoiceSample(); } }}
                  />
                  <Button variant="ghost" size="sm" onClick={addVoiceSample} disabled={!newSample.line.trim()}>追加</Button>
                </div>
              </div>
            </div>

            {/* Dialogue examples */}
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                会話例（Few-shot）
                <span className="text-gray-400 ml-1">（読者メッセージと理想の返答をセットで登録）</span>
              </label>
              {dialogueExamples.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {dialogueExamples.map((ex, i) => (
                    <li key={i} className="bg-gray-50 rounded px-2 py-1.5 text-xs space-y-0.5">
                      {ex.context && <p className="text-gray-400 truncate">状況: {ex.context}</p>}
                      <p className="text-indigo-600 truncate">読者: {ex.user_message_pattern}</p>
                      <p className="text-gray-700 line-clamp-2">{ex.ideal_response}</p>
                      <button
                        className="text-gray-300 hover:text-red-500 text-xs"
                        onClick={() => removeDialogueExample(i)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showExForm ? (
                <div className="border border-gray-200 rounded p-2.5 space-y-1.5">
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                    placeholder="状況（任意）例: 初対面のとき"
                    value={newEx.context}
                    onChange={e => setNewEx(f => ({ ...f, context: e.target.value }))}
                  />
                  <input
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                    placeholder="読者メッセージ例 *"
                    value={newEx.user_message_pattern}
                    onChange={e => setNewEx(f => ({ ...f, user_message_pattern: e.target.value }))}
                  />
                  <textarea
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-none"
                    rows={3}
                    placeholder="理想の返答 *"
                    value={newEx.ideal_response}
                    onChange={e => setNewEx(f => ({ ...f, ideal_response: e.target.value }))}
                  />
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setShowExForm(false); setNewEx({ context: "", user_message_pattern: "", ideal_response: "" }); }}>キャンセル</Button>
                    <Button size="sm" className="flex-1" onClick={addDialogueExample} disabled={!newEx.user_message_pattern.trim() || !newEx.ideal_response.trim()}>追加</Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowExForm(true)}>
                  + 会話例を追加
                </Button>
              )}
            </div>
          </>
        )}

        {activeTab === "limits" && (
          <>
            <p className="text-xs text-gray-400">1行に1項目。ロックした項目は読者が変更できません。</p>
            <div>
              <label className="block text-xs text-gray-600 mb-1">積極的に行うこと</label>
              <textarea
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                rows={3}
                placeholder={"例:\n詩的な表現を多用する\n哲学的な問いを読者に投げかける"}
                value={extForm.will_do}
                onChange={e => setExtForm(f => ({ ...f, will_do: e.target.value }))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">絶対にしないこと</label>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" className="accent-indigo-600" checked={lockedFields.includes("will_not_do")} onChange={() => toggleLock("will_not_do")} />
                  🔒 変更不可
                </label>
              </div>
              <textarea
                className={`w-full border rounded px-2 py-1.5 text-sm resize-none ${isLocked("will_not_do") ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300"}`}
                rows={4}
                placeholder={"例:\n自分が異世界の王子であることを明かす"}
                value={extForm.will_not_do}
                onChange={e => setExtForm(f => ({ ...f, will_not_do: e.target.value }))}
                disabled={isLocked("will_not_do")}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">応答しないトピック</label>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" className="accent-indigo-600" checked={lockedFields.includes("forbidden_topics")} onChange={() => toggleLock("forbidden_topics")} />
                  🔒 変更不可
                </label>
              </div>
              <textarea
                className={`w-full border rounded px-2 py-1.5 text-sm resize-none ${isLocked("forbidden_topics") ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-300"}`}
                rows={4}
                placeholder={"例:\n第4章以降の出来事"}
                value={extForm.forbidden_topics}
                onChange={e => setExtForm(f => ({ ...f, forbidden_topics: e.target.value }))}
                disabled={isLocked("forbidden_topics")}
              />
            </div>
          </>
        )}

        {activeTab === "versions" && (
          <>
            <p className="text-xs text-gray-400">
              成長・変化・回想など、異なる時期の人格を登録できます。読者はチャット開始時に版本を選べます。
            </p>

            {/* Existing snapshots */}
            {snapshots.length > 0 && (
              <ul className="space-y-2">
                {snapshots.map(s => (
                  <li key={s.id} className="border border-gray-200 rounded p-2 text-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-medium">{s.label}</span>
                        {s.character_age && <span className="ml-2 text-gray-400">{s.character_age}</span>}
                        {s.from_chapter != null
                          ? <span className="ml-2 text-gray-400">第{s.from_chapter}章〜</span>
                          : <span className="ml-2 text-gray-400">（時系列外）</span>
                        }
                        {s.is_selectable && <span className="ml-2 text-indigo-500">読者選択可</span>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => startEditSnap(s)}>編集</Button>
                        <Button variant="danger" size="sm" onClick={() => deleteSnap(s.id!)}>削除</Button>
                      </div>
                    </div>
                    {s.change_reason && <p className="text-gray-400 mt-1">📝 {s.change_reason}</p>}
                  </li>
                ))}
              </ul>
            )}

            {/* Snapshot form */}
            {isSnapEditing ? (
              <div className="border border-indigo-200 rounded p-3 space-y-3 bg-indigo-50 text-sm">
                <h4 className="text-xs font-semibold text-indigo-700">{editingSnap ? "バージョンを編集" : "バージョンを追加"}</h4>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-600 mb-1">ラベル *</label>
                    <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="少年時代" value={snapForm.label} onChange={e => setSnapForm(f => ({ ...f, label: e.target.value }))} />
                  </div>
                  <div className="w-20">
                    <label className="block text-xs text-gray-600 mb-1">年齢</label>
                    <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="7歳頃" value={snapForm.character_age} onChange={e => setSnapForm(f => ({ ...f, character_age: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="w-28">
                    <label className="block text-xs text-gray-600 mb-1">適用開始章</label>
                    <input type="number" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="空=時系列外" value={snapForm.from_chapter} onChange={e => setSnapForm(f => ({ ...f, from_chapter: e.target.value }))} />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-600 pb-1">
                    <input type="checkbox" className="accent-indigo-600" checked={snapForm.is_selectable} onChange={e => setSnapForm(f => ({ ...f, is_selectable: e.target.checked }))} />
                    読者が選択可能
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">ペルソナ変更（空欄=ベース設定を使用）</label>
                  <textarea className="w-full border border-gray-300 rounded px-2 py-1 text-xs resize-none" rows={3} placeholder="この時期の人格説明..." value={snapForm.persona_override} onChange={e => setSnapForm(f => ({ ...f, persona_override: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">話し方変更（空欄=ベース設定を使用）</label>
                  <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="幼い話し方。「〜だもん」" value={snapForm.speech_style_override} onChange={e => setSnapForm(f => ({ ...f, speech_style_override: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">メモ（作者内部用）</label>
                  <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs" placeholder="第10章の回想シーン" value={snapForm.change_reason} onChange={e => setSnapForm(f => ({ ...f, change_reason: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setSnapForm({ label: "", character_age: "", from_chapter: "", is_selectable: true, persona_override: "", speech_style_override: "", change_reason: "" })}>キャンセル</Button>
                  <Button size="sm" className="flex-1" onClick={saveSnap} disabled={!snapForm.label}>
                    {editingSnap ? "更新" : "追加"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full" onClick={startNewSnap}>+ バージョンを追加</Button>
            )}
          </>
        )}

        {activeTab === "performer" && (
          <>
            {skillLoading ? (
              <p className="text-center text-xs text-gray-400 mt-8">読み込み中...</p>
            ) : skill === null ? (
              <div className="text-center mt-8 space-y-3">
                <p className="text-xs text-gray-400">まだ演者プロフィールが生成されていません。</p>
                <Button onClick={handleGenerateSkill} disabled={skillGenerating}>
                  {skillGenerating ? "生成中..." : "AIで生成"}
                </Button>
              </div>
            ) : (
              <>
                <div className="bg-gray-50 rounded px-3 py-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{skill.name}</span>
                  <span className="ml-2">（{skill.archetype}）</span>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">口調・話し方（素）</label>
                  <textarea
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                    rows={2}
                    value={skill.off_set_persona.casual_style}
                    onChange={e => updateSkillLocal({ off_set_persona: { ...skill.off_set_persona, casual_style: e.target.value } })}
                    onBlur={() => persistSkill({ off_set_persona: skill.off_set_persona })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">口癖・クセ</label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {skill.off_set_persona.quirks.map((q, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-full text-xs">
                        {q}
                        <button className="text-gray-400 hover:text-red-500 leading-none" onClick={() => removeQuirk(i)}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="追加... Enter"
                      value={newQuirk}
                      onChange={e => setNewQuirk(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQuirk(); } }}
                    />
                    <Button variant="ghost" size="sm" onClick={addQuirk} disabled={!newQuirk.trim()}>追加</Button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">趣味・関心</label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {skill.off_set_interests.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-xs">
                        {t}
                        <button className="text-indigo-300 hover:text-red-500 leading-none" onClick={() => removeInterest(i)}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="追加... Enter"
                      value={newInterest}
                      onChange={e => setNewInterest(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }}
                    />
                    <Button variant="ghost" size="sm" onClick={addInterest} disabled={!newInterest.trim()}>追加</Button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">演技スタイル</label>
                  <textarea
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                    rows={2}
                    value={skill.signature_style.acting_method}
                    onChange={e => updateSkillLocal({ signature_style: { ...skill.signature_style, acting_method: e.target.value } })}
                    onBlur={() => persistSkill({ signature_style: skill.signature_style })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">キャラクターとの対比</label>
                  <textarea
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
                    rows={2}
                    value={skill.contrast_with_role_hints}
                    onChange={e => updateSkillLocal({ contrast_with_role_hints: e.target.value })}
                    onBlur={() => persistSkill({ contrast_with_role_hints: skill.contrast_with_role_hints })}
                  />
                </div>

                <Button variant="ghost" className="w-full" onClick={handleRegenerateSkill} disabled={skillGenerating}>
                  {skillGenerating ? "再生成中..." : "LLMで再生成"}
                </Button>
              </>
            )}
          </>
        )}

        {activeTab !== "performer" && (
          <>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : isNew ? "追加" : "保存"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

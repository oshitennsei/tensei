import { useState, useEffect } from "react";
import { db } from "@/lib/storage";
import type { Work, Entity, CharacterExtended, CharacterStateSnapshot, LockedField, VoiceSample, PerformerSkill } from "@/lib/storage";
import { getOrCreateSkill, regenerateSkill, saveSkillField } from "@/lib/bts";
import { useStrings } from "@/lib/i18n";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg:         "#080a14",
  cardBg:     "rgba(13,13,36,0.82)",
  border:     "rgba(99,102,241,0.18)",
  borderFocus:"rgba(99,102,241,0.55)",
  indigo:     "#818cf8",
  indigoDim:  "rgba(99,102,241,0.12)",
  text:       "#e2e8f0",
  muted:      "#64748b",
  mutedLight: "#94a3b8",
  danger:     "rgba(239,68,68,0.85)",
  dangerDim:  "rgba(239,68,68,0.08)",
};

// ─── Shared micro-components ─────────────────────────────────────────────────

function DarkBtn({
  onClick, disabled, children, variant = "primary", full = false, className = "",
}: {
  onClick?: () => void; disabled?: boolean; children: React.ReactNode;
  variant?: "primary" | "ghost" | "danger"; full?: boolean; className?: string;
}) {
  const base = "text-xs font-semibold rounded-lg px-3 py-1.5 transition-all disabled:opacity-40 ";
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" },
    ghost:   { background: C.indigoDim, border: `1px solid ${C.border}`, color: C.indigo },
    danger:  { background: C.dangerDim, border: "1px solid rgba(239,68,68,0.22)", color: C.danger },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={base + (full ? "w-full py-2 " : "") + className}
      style={styles[variant]}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}

const inputCls = "w-full rounded-lg px-3 py-1.5 text-sm outline-none transition-colors";
const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  color: C.text,
};
const disabledStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: `1px solid rgba(99,102,241,0.08)`,
  color: C.muted,
  cursor: "not-allowed",
};

function DI({ value, onChange, onBlur, placeholder, disabled, className = "" }:
  { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; disabled?: boolean; className?: string }) {
  return (
    <input
      className={inputCls + " " + className}
      style={disabled ? disabledStyle : inputStyle}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = C.borderFocus; }}
      onBlur_={e => { e.currentTarget.style.borderColor = C.border; }}
    />
  );
}

function DTA({ value, onChange, onBlur, placeholder, rows = 3, disabled, className = "" }:
  { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; rows?: number; disabled?: boolean; className?: string }) {
  return (
    <textarea
      className={inputCls + " resize-none " + className}
      style={disabled ? disabledStyle : inputStyle}
      rows={rows}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = C.borderFocus; }}
    />
  );
}

function FL({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs mb-1" style={{ color: C.muted }}>{children}</label>;
}

function LockRow({ label, checked, onChange, disabled, lockLabel }:
  { label: string; checked: boolean; onChange: () => void; disabled: boolean; lockLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs" style={{ color: C.muted }}>{label}</span>
      <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: C.muted }}>
        <input
          type="checkbox"
          className="accent-indigo-500"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        {lockLabel}
      </label>
    </div>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────
interface Props {
  work: Work;
  character_id: string | null;
  onBack: () => void;
  onSaved: () => void;
}

const BLANK_ENTITY = { canonical_name: "", aliases: "", description: "" };
const BLANK_EXT    = { persona: "", speech_style: "", will_do: "", will_not_do: "", forbidden_topics: "" };

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

// ─── Component ───────────────────────────────────────────────────────────────
export function CharacterEditScreen({ work, character_id, onBack, onSaved }: Props) {
  const str = useStrings();
  const [entityForm, setEntityForm] = useState(BLANK_ENTITY);
  const [extForm, setExtForm] = useState(BLANK_EXT);
  const [lockedFields, setLockedFields] = useState<LockedField[]>([]);
  const [authorProvided, setAuthorProvided] = useState(false);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [pendingSamples, setPendingSamples] = useState<VoiceSample[]>([]);
  const [newSample, setNewSample] = useState<{ context: string; line: string }>({ context: "", line: "" });
  const [dialogueExamples, setDialogueExamples] = useState<NonNullable<CharacterExtended["dialogue_examples"]>>([]);
  const [showExForm, setShowExForm] = useState(false);
  const [newEx, setNewEx] = useState({ context: "", user_message_pattern: "", ideal_response: "" });
  const [snapshots, setSnapshots] = useState<CharacterStateSnapshot[]>([]);
  const [showSnapForm, setShowSnapForm] = useState(false);
  const [editingSnap, setEditingSnap] = useState<CharacterStateSnapshot | null>(null);
  const [snapForm, setSnapForm] = useState({
    label: "", character_age: "", from_chapter: "", is_selectable: true,
    persona_override: "", speech_style_override: "", change_reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "limits" | "versions" | "performer">("basic");

  const [skill, setSkill] = useState<PerformerSkill | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillGenerating, setSkillGenerating] = useState(false);
  const [newQuirk, setNewQuirk] = useState("");
  const [newInterest, setNewInterest] = useState("");

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
        setPendingSamples(ext.pending_voice_samples ?? []);
        setDialogueExamples(ext.dialogue_examples ?? []);
        setSnapshots(ext.state_snapshots ?? []);
      }
    })();
  }, [character_id]);

  useEffect(() => {
    if (activeTab !== "performer" || !character_id) return;
    setSkillLoading(true);
    db.performer_skills.get(character_id).then(s => { setSkill(s ?? null); setSkillLoading(false); });
  }, [activeTab, character_id]);

  // ── Performer ──────────────────────────────────────────────────────────────

  const handleGenerateSkill = async () => {
    if (!character_id) return;
    setSkillGenerating(true);
    try { setSkill(await getOrCreateSkill(character_id, work.id)); }
    finally { setSkillGenerating(false); }
  };

  const handleRegenerateSkill = async () => {
    if (!character_id) return;
    setSkillGenerating(true);
    try { setSkill(await regenerateSkill(character_id, work.id)); }
    finally { setSkillGenerating(false); }
  };

  const updateSkillLocal = (updates: Partial<PerformerSkill>) =>
    setSkill(prev => prev ? { ...prev, ...updates } : prev);

  const persistSkill = async (updates: Partial<PerformerSkill>) => {
    if (!character_id) return;
    await saveSkillField(character_id, updates);
  };

  const addQuirk = async () => {
    if (!skill || !newQuirk.trim()) return;
    const off_set_persona = { ...skill.off_set_persona, quirks: [...skill.off_set_persona.quirks, newQuirk.trim()] };
    updateSkillLocal({ off_set_persona }); await persistSkill({ off_set_persona }); setNewQuirk("");
  };
  const removeQuirk = async (i: number) => {
    if (!skill) return;
    const off_set_persona = { ...skill.off_set_persona, quirks: skill.off_set_persona.quirks.filter((_, idx) => idx !== i) };
    updateSkillLocal({ off_set_persona }); await persistSkill({ off_set_persona });
  };
  const addInterest = async () => {
    if (!skill || !newInterest.trim()) return;
    const off_set_interests = [...skill.off_set_interests, newInterest.trim()];
    updateSkillLocal({ off_set_interests }); await persistSkill({ off_set_interests }); setNewInterest("");
  };
  const removeInterest = async (i: number) => {
    if (!skill) return;
    const off_set_interests = skill.off_set_interests.filter((_, idx) => idx !== i);
    updateSkillLocal({ off_set_interests }); await persistSkill({ off_set_interests });
  };

  // ── Misc ──────────────────────────────────────────────────────────────────

  const toggleLock = (field: LockedField) =>
    setLockedFields(prev => prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]);

  const isLocked = (field: LockedField) => authorProvided && lockedFields.includes(field);

  const handleSave = async () => {
    if (!entityForm.canonical_name.trim()) { setError(str.edit_error_name); return; }
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
    const blob = new Blob([buildExportJson(entity, ext)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${entity.canonical_name.replace(/\s+/g, "_")}.tensei.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const addVoiceSample = () => {
    if (!newSample.line.trim()) return;
    setVoiceSamples(prev => [...prev, { context: newSample.context.trim(), line: newSample.line.trim() }]);
    setNewSample({ context: "", line: "" });
  };
  const removeVoiceSample = (i: number) => setVoiceSamples(prev => prev.filter((_, idx) => idx !== i));

  const acceptPendingSample = async (i: number) => {
    if (!character_id) return;
    const sample = pendingSamples[i];
    const newPending = pendingSamples.filter((_, idx) => idx !== i);
    const newVoice = [...voiceSamples, sample];
    setPendingSamples(newPending); setVoiceSamples(newVoice);
    await db.characters_extended.update(character_id, { pending_voice_samples: newPending, voice_samples: newVoice });
  };
  const rejectPendingSample = async (i: number) => {
    if (!character_id) return;
    const newPending = pendingSamples.filter((_, idx) => idx !== i);
    setPendingSamples(newPending);
    await db.characters_extended.update(character_id, { pending_voice_samples: newPending });
  };

  const addDialogueExample = () => {
    if (!newEx.user_message_pattern.trim() || !newEx.ideal_response.trim()) return;
    setDialogueExamples(prev => [...prev, { context: newEx.context.trim(), user_message_pattern: newEx.user_message_pattern.trim(), ideal_response: newEx.ideal_response.trim() }]);
    setNewEx({ context: "", user_message_pattern: "", ideal_response: "" });
    setShowExForm(false);
  };
  const removeDialogueExample = (i: number) => setDialogueExamples(prev => prev.filter((_, idx) => idx !== i));

  const startNewSnap = () => {
    setEditingSnap(null);
    setSnapForm({ label: "", character_age: "", from_chapter: "", is_selectable: true, persona_override: "", speech_style_override: "", change_reason: "" });
    setShowSnapForm(true);
  };
  const startEditSnap = (s: CharacterStateSnapshot) => {
    setEditingSnap(s);
    setSnapForm({ label: s.label ?? "", character_age: s.character_age ?? "", from_chapter: s.from_chapter != null ? String(s.from_chapter) : "", is_selectable: s.is_selectable ?? true, persona_override: s.persona_override ?? "", speech_style_override: s.speech_style_override ?? "", change_reason: s.change_reason ?? "" });
    setShowSnapForm(true);
  };
  const cancelSnap = () => { setShowSnapForm(false); setEditingSnap(null); setSnapForm({ label: "", character_age: "", from_chapter: "", is_selectable: true, persona_override: "", speech_style_override: "", change_reason: "" }); };
  const saveSnap = () => {
    const snap: CharacterStateSnapshot = {
      id: editingSnap?.id ?? crypto.randomUUID(),
      label: snapForm.label || str.snap_version_default,
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
    if (editingSnap) setSnapshots(prev => prev.map(s => s.id === editingSnap.id ? snap : s));
    else setSnapshots(prev => [...prev, snap]);
    cancelSnap();
  };
  const deleteSnap = (id: string) => setSnapshots(prev => prev.filter(s => s.id !== id));

  const isNew = character_id === null;

  const tabLabel = (tab: string) => {
    if (tab === "basic")    return str.tab_basic;
    if (tab === "limits")   return str.tab_limits;
    if (tab === "versions") return str.tab_versions;
    return str.tab_performer;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg, color: C.text }}>

      {/* ── Header ── */}
      <header
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,10,20,0.97)" }}
      >
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all"
          style={{ color: C.muted }}
          onMouseEnter={e => { e.currentTarget.style.color = C.indigo; e.currentTarget.style.background = C.indigoDim; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
          onClick={onBack}
        >←</button>
        <h2 className="flex-1 text-sm font-semibold truncate" style={{ color: C.text }}>
          {isNew ? str.edit_add_title : str.edit_edit_title}
        </h2>
        {character_id && (
          <DarkBtn variant="ghost" onClick={handleExport}>{str.edit_json_export}</DarkBtn>
        )}
      </header>

      {/* ── Tab bar ── */}
      <div
        className="flex shrink-0"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,10,20,0.97)" }}
      >
        {(["basic", "limits", "versions", ...(character_id ? ["performer"] : [])] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className="flex-1 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: activeTab === tab ? C.indigo : C.muted,
              borderBottom: activeTab === tab ? `2px solid ${C.indigo}` : "2px solid transparent",
            }}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ══ BASIC TAB ══ */}
        {activeTab === "basic" && (
          <>
            <div>
              <FL>{str.field_char_name}</FL>
              <DI value={entityForm.canonical_name} onChange={v => setEntityForm(f => ({ ...f, canonical_name: v }))} placeholder={str.field_char_name_ph} />
            </div>
            <div>
              <FL>{str.field_aliases}</FL>
              <DI value={entityForm.aliases} onChange={v => setEntityForm(f => ({ ...f, aliases: v }))} placeholder={str.field_aliases_ph} />
            </div>
            <div>
              <FL>{str.field_description}</FL>
              <DTA rows={2} value={entityForm.description} onChange={v => setEntityForm(f => ({ ...f, description: v }))} />
            </div>

            {/* Persona */}
            <div>
              <LockRow
                label={str.field_persona_label}
                checked={lockedFields.includes("persona")}
                onChange={() => toggleLock("persona")}
                disabled={isLocked("persona")}
                lockLabel={isLocked("persona") ? str.lock_author : str.lock_user}
              />
              <DTA rows={6} value={extForm.persona} onChange={v => setExtForm(f => ({ ...f, persona: v }))} placeholder={str.field_persona_ph} disabled={isLocked("persona")} />
            </div>

            {/* Speech style */}
            <div>
              <LockRow
                label={str.field_speech_label}
                checked={lockedFields.includes("speech_style")}
                onChange={() => toggleLock("speech_style")}
                disabled={isLocked("speech_style")}
                lockLabel={isLocked("speech_style") ? str.lock_author : str.lock_user}
              />
              <DTA rows={2} value={extForm.speech_style} onChange={v => setExtForm(f => ({ ...f, speech_style: v }))} placeholder={str.field_speech_ph} disabled={isLocked("speech_style")} />
            </div>

            {/* Pending voice samples */}
            {pendingSamples.length > 0 && (
              <div
                className="rounded-xl p-3 space-y-2"
                style={{ background: "rgba(99,102,241,0.06)", border: `1px solid rgba(99,102,241,0.2)` }}
              >
                <p className="text-xs font-semibold" style={{ color: C.indigo }}>{str.char_pending_header}</p>
                {pendingSamples.map((s, i) => (
                  <div key={i} className="rounded-lg px-2.5 py-2" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                    {s.context && <p className="text-xs truncate mb-0.5" style={{ color: C.muted }}>【{s.context}】</p>}
                    <p className="text-xs mb-1.5" style={{ color: C.mutedLight }}>「{s.line.slice(0, 120)}{s.line.length > 120 ? "…」" : "」"}</p>
                    <div className="flex gap-1.5">
                      <DarkBtn onClick={() => acceptPendingSample(i)}>{str.char_pending_accept}</DarkBtn>
                      <DarkBtn variant="ghost" onClick={() => rejectPendingSample(i)}>{str.char_pending_reject}</DarkBtn>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Voice samples */}
            <div>
              <FL>{str.voice_samples_label} <span className="ml-1" style={{ color: C.muted }}>{str.voice_samples_sub}</span></FL>
              {voiceSamples.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {voiceSamples.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs rounded-lg px-2.5 py-1.5" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                      <div className="flex-1 min-w-0">
                        {s.context && <p className="truncate" style={{ color: C.muted }}>【{s.context}】</p>}
                        <p style={{ color: C.mutedLight }}>「{s.line}」</p>
                      </div>
                      <button className="shrink-0 leading-none transition-colors" style={{ color: C.muted }} onMouseEnter={e => { e.currentTarget.style.color = C.danger; }} onMouseLeave={e => { e.currentTarget.style.color = C.muted; }} onClick={() => removeVoiceSample(i)}>×</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-1.5">
                <DI value={newSample.context} onChange={v => setNewSample(s => ({ ...s, context: v }))} placeholder={str.voice_context_ph} className="text-xs" />
                <div className="flex gap-1.5">
                  <input
                    className={inputCls + " flex-1 text-xs"}
                    style={inputStyle}
                    placeholder={str.voice_line_ph}
                    value={newSample.line}
                    onChange={e => setNewSample(s => ({ ...s, line: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addVoiceSample(); } }}
                    onFocus={e => { e.currentTarget.style.borderColor = C.borderFocus; }}
                    onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
                  />
                  <DarkBtn variant="ghost" onClick={addVoiceSample} disabled={!newSample.line.trim()}>{str.edit_add_sample}</DarkBtn>
                </div>
              </div>
            </div>

            {/* Dialogue examples */}
            <div>
              <FL>{str.dialogue_ex_label} <span className="ml-1" style={{ color: C.muted }}>{str.dialogue_ex_sub}</span></FL>
              {dialogueExamples.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {dialogueExamples.map((ex, i) => (
                    <li key={i} className="rounded-lg px-2.5 py-2 text-xs space-y-0.5" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                      {ex.context && <p className="truncate" style={{ color: C.muted }}>{str.situation_label}: {ex.context}</p>}
                      <p className="truncate" style={{ color: C.indigo }}>{str.dialogue_reader}: {ex.user_message_pattern}</p>
                      <p className="line-clamp-2" style={{ color: C.mutedLight }}>{ex.ideal_response}</p>
                      <button className="text-xs transition-colors mt-0.5" style={{ color: C.muted }} onMouseEnter={e => { e.currentTarget.style.color = C.danger; }} onMouseLeave={e => { e.currentTarget.style.color = C.muted; }} onClick={() => removeDialogueExample(i)}>{str.char_delete}</button>
                    </li>
                  ))}
                </ul>
              )}
              {showExForm ? (
                <div className="rounded-xl p-3 space-y-2" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                  <DI value={newEx.context} onChange={v => setNewEx(f => ({ ...f, context: v }))} placeholder={str.dialogue_context_ph} className="text-xs" />
                  <DI value={newEx.user_message_pattern} onChange={v => setNewEx(f => ({ ...f, user_message_pattern: v }))} placeholder={str.dialogue_pattern_ph} className="text-xs" />
                  <DTA rows={3} value={newEx.ideal_response} onChange={v => setNewEx(f => ({ ...f, ideal_response: v }))} placeholder={str.dialogue_response_ph} className="text-xs" />
                  <div className="flex gap-1.5">
                    <DarkBtn variant="ghost" className="flex-1" onClick={() => { setShowExForm(false); setNewEx({ context: "", user_message_pattern: "", ideal_response: "" }); }}>{str.edit_cancel}</DarkBtn>
                    <DarkBtn className="flex-1" onClick={addDialogueExample} disabled={!newEx.user_message_pattern.trim() || !newEx.ideal_response.trim()}>{str.edit_add_sample}</DarkBtn>
                  </div>
                </div>
              ) : (
                <DarkBtn variant="ghost" full onClick={() => setShowExForm(true)}>{str.add_dialogue}</DarkBtn>
              )}
            </div>
          </>
        )}

        {/* ══ LIMITS TAB ══ */}
        {activeTab === "limits" && (
          <>
            <p className="text-xs" style={{ color: C.muted }}>{str.limits_hint}</p>
            <div>
              <FL>{str.field_will_do}</FL>
              <DTA rows={3} value={extForm.will_do} onChange={v => setExtForm(f => ({ ...f, will_do: v }))} placeholder={str.field_will_do_ph} />
            </div>
            <div>
              <LockRow label={str.field_will_not_do} checked={lockedFields.includes("will_not_do")} onChange={() => toggleLock("will_not_do")} disabled={isLocked("will_not_do")} lockLabel={str.lock_user} />
              <DTA rows={4} value={extForm.will_not_do} onChange={v => setExtForm(f => ({ ...f, will_not_do: v }))} placeholder={str.field_will_not_do_ph} disabled={isLocked("will_not_do")} />
            </div>
            <div>
              <LockRow label={str.field_forbidden} checked={lockedFields.includes("forbidden_topics")} onChange={() => toggleLock("forbidden_topics")} disabled={isLocked("forbidden_topics")} lockLabel={str.lock_user} />
              <DTA rows={4} value={extForm.forbidden_topics} onChange={v => setExtForm(f => ({ ...f, forbidden_topics: v }))} placeholder={str.field_forbidden_ph} disabled={isLocked("forbidden_topics")} />
            </div>
          </>
        )}

        {/* ══ VERSIONS TAB ══ */}
        {activeTab === "versions" && (
          <>
            <p className="text-xs" style={{ color: C.muted }}>{str.versions_hint}</p>
            {snapshots.length > 0 && (
              <ul className="space-y-2">
                {snapshots.map(s => (
                  <li key={s.id} className="rounded-xl px-3 py-2.5" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold" style={{ color: C.text }}>{s.label}</span>
                        {s.character_age && <span className="ml-2 text-xs" style={{ color: C.muted }}>{s.character_age}</span>}
                        {s.from_chapter != null
                          ? <span className="ml-2 text-xs" style={{ color: C.muted }}>{str.snap_from_chapter(s.from_chapter)}</span>
                          : <span className="ml-2 text-xs" style={{ color: C.muted }}>{str.snap_outside_timeline}</span>
                        }
                        {s.is_selectable && <span className="ml-2 text-xs" style={{ color: C.indigo }}>{str.snap_selectable_badge}</span>}
                        {s.change_reason && <p className="text-xs mt-1" style={{ color: C.muted }}>📝 {s.change_reason}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <DarkBtn variant="ghost" onClick={() => startEditSnap(s)}>{str.char_edit}</DarkBtn>
                        <DarkBtn variant="danger" onClick={() => deleteSnap(s.id!)}>{str.char_delete}</DarkBtn>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {showSnapForm ? (
              <div className="rounded-xl p-3 space-y-3" style={{ background: C.cardBg, border: `1px solid rgba(99,102,241,0.3)` }}>
                <p className="text-xs font-semibold" style={{ color: C.indigo }}>{editingSnap ? str.snap_edit_title : str.snap_add_title}</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FL>{str.snap_field_label}</FL>
                    <DI value={snapForm.label} onChange={v => setSnapForm(f => ({ ...f, label: v }))} placeholder="少年時代" className="text-xs" />
                  </div>
                  <div className="w-20">
                    <FL>{str.snap_field_age}</FL>
                    <DI value={snapForm.character_age} onChange={v => setSnapForm(f => ({ ...f, character_age: v }))} placeholder="7歳頃" className="text-xs" />
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="w-28">
                    <FL>{str.snap_field_chapter}</FL>
                    <input
                      type="number"
                      className={inputCls + " text-xs"}
                      style={inputStyle}
                      placeholder="空=時系列外"
                      value={snapForm.from_chapter}
                      onChange={e => setSnapForm(f => ({ ...f, from_chapter: e.target.value }))}
                      onFocus={e => { e.currentTarget.style.borderColor = C.borderFocus; }}
                      onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
                    />
                  </div>
                  <label className="flex items-center gap-1 text-xs pb-1 cursor-pointer" style={{ color: C.muted }}>
                    <input type="checkbox" className="accent-indigo-500" checked={snapForm.is_selectable} onChange={e => setSnapForm(f => ({ ...f, is_selectable: e.target.checked }))} />
                    {str.snap_selectable}
                  </label>
                </div>
                <div>
                  <FL>{str.snap_persona_ov}</FL>
                  <DTA rows={3} value={snapForm.persona_override} onChange={v => setSnapForm(f => ({ ...f, persona_override: v }))} placeholder={str.snap_persona_ov_ph} className="text-xs" />
                </div>
                <div>
                  <FL>{str.snap_speech_ov}</FL>
                  <DI value={snapForm.speech_style_override} onChange={v => setSnapForm(f => ({ ...f, speech_style_override: v }))} placeholder={str.snap_speech_ov_ph} className="text-xs" />
                </div>
                <div>
                  <FL>{str.snap_notes}</FL>
                  <DI value={snapForm.change_reason} onChange={v => setSnapForm(f => ({ ...f, change_reason: v }))} placeholder={str.snap_notes_ph} className="text-xs" />
                </div>
                <div className="flex gap-2">
                  <DarkBtn variant="ghost" className="flex-1" onClick={cancelSnap}>{str.snap_cancel}</DarkBtn>
                  <DarkBtn className="flex-1" onClick={saveSnap} disabled={!snapForm.label}>{editingSnap ? str.snap_update : str.snap_add_confirm}</DarkBtn>
                </div>
              </div>
            ) : (
              <DarkBtn variant="ghost" full onClick={startNewSnap}>{str.snap_add_btn}</DarkBtn>
            )}
          </>
        )}

        {/* ══ PERFORMER TAB ══ */}
        {activeTab === "performer" && (
          <>
            {skillLoading ? (
              <p className="text-center text-xs mt-8" style={{ color: C.muted }}>{str.performer_loading}</p>
            ) : skill === null ? (
              <div className="text-center mt-8 space-y-3">
                <p className="text-xs" style={{ color: C.muted }}>{str.performer_empty}</p>
                <DarkBtn onClick={handleGenerateSkill} disabled={skillGenerating}>
                  {skillGenerating ? str.performer_generating : str.performer_generate}
                </DarkBtn>
              </div>
            ) : (
              <>
                <section>
                  <p className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: C.muted }}>{str.performer_bio_section}</p>
                  <div className="rounded-lg px-3 py-2 mb-2 text-xs" style={{ background: C.cardBg, border: `1px solid ${C.border}` }}>
                    <span className="font-medium" style={{ color: C.text }}>{skill.display_name ?? skill.name}</span>
                    <span className="ml-2" style={{ color: C.muted }}>（{skill.archetype}）</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <FL>{str.performer_display_name}</FL>
                      <DI value={skill.display_name ?? ""} onChange={v => updateSkillLocal({ display_name: v })} onBlur={() => persistSkill({ display_name: skill.display_name })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><FL>{str.performer_gender}</FL><DI value={skill.gender ?? ""} onChange={v => updateSkillLocal({ gender: v })} onBlur={() => persistSkill({ gender: skill.gender })} /></div>
                      <div><FL>{str.performer_birthday}</FL><DI value={skill.birthday ?? ""} onChange={v => updateSkillLocal({ birthday: v })} onBlur={() => persistSkill({ birthday: skill.birthday })} /></div>
                      <div><FL>{str.performer_height}</FL><DI value={skill.height ?? ""} onChange={v => updateSkillLocal({ height: v })} onBlur={() => persistSkill({ height: skill.height })} /></div>
                      <div><FL>{str.performer_birthplace}</FL><DI value={skill.birthplace ?? ""} onChange={v => updateSkillLocal({ birthplace: v })} onBlur={() => persistSkill({ birthplace: skill.birthplace })} /></div>
                    </div>
                    <div>
                      <FL>{str.performer_background}</FL>
                      <DTA rows={2} value={skill.career_background ?? ""} onChange={v => updateSkillLocal({ career_background: v })} onBlur={() => persistSkill({ career_background: skill.career_background })} />
                    </div>
                  </div>
                </section>

                <div>
                  <FL>{str.performer_casual}</FL>
                  <DTA rows={2} value={skill.off_set_persona.casual_style} onChange={v => updateSkillLocal({ off_set_persona: { ...skill.off_set_persona, casual_style: v } })} onBlur={() => persistSkill({ off_set_persona: skill.off_set_persona })} />
                </div>

                <div>
                  <FL>{str.performer_quirks}</FL>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {skill.off_set_persona.quirks.map((q, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: C.indigoDim, border: `1px solid ${C.border}`, color: C.mutedLight }}>
                        {q}
                        <button style={{ color: C.muted }} onMouseEnter={e => { e.currentTarget.style.color = C.danger; }} onMouseLeave={e => { e.currentTarget.style.color = C.muted; }} onClick={() => removeQuirk(i)}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input className={inputCls + " flex-1 text-xs"} style={inputStyle} placeholder={str.add_ph} value={newQuirk} onChange={e => setNewQuirk(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQuirk(); } }} onFocus={e => { e.currentTarget.style.borderColor = C.borderFocus; }} onBlur={e => { e.currentTarget.style.borderColor = C.border; }} />
                    <DarkBtn variant="ghost" onClick={addQuirk} disabled={!newQuirk.trim()}>{str.edit_add_sample}</DarkBtn>
                  </div>
                </div>

                <div>
                  <FL>{str.performer_interests}</FL>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {skill.off_set_interests.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "rgba(99,102,241,0.16)", border: `1px solid rgba(99,102,241,0.3)`, color: C.indigo }}>
                        {t}
                        <button style={{ color: "rgba(99,102,241,0.5)" }} onMouseEnter={e => { e.currentTarget.style.color = C.danger; }} onMouseLeave={e => { e.currentTarget.style.color = "rgba(99,102,241,0.5)"; }} onClick={() => removeInterest(i)}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input className={inputCls + " flex-1 text-xs"} style={inputStyle} placeholder={str.add_ph} value={newInterest} onChange={e => setNewInterest(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }} onFocus={e => { e.currentTarget.style.borderColor = C.borderFocus; }} onBlur={e => { e.currentTarget.style.borderColor = C.border; }} />
                    <DarkBtn variant="ghost" onClick={addInterest} disabled={!newInterest.trim()}>{str.edit_add_sample}</DarkBtn>
                  </div>
                </div>

                <div>
                  <FL>{str.performer_acting}</FL>
                  <DTA rows={2} value={skill.signature_style.acting_method} onChange={v => updateSkillLocal({ signature_style: { ...skill.signature_style, acting_method: v } })} onBlur={() => persistSkill({ signature_style: skill.signature_style })} />
                </div>
                <div>
                  <FL>{str.performer_contrast}</FL>
                  <DTA rows={2} value={skill.contrast_with_role_hints} onChange={v => updateSkillLocal({ contrast_with_role_hints: v })} onBlur={() => persistSkill({ contrast_with_role_hints: skill.contrast_with_role_hints })} />
                </div>

                <DarkBtn variant="ghost" full onClick={handleRegenerateSkill} disabled={skillGenerating}>
                  {skillGenerating ? str.performer_regenning : str.performer_regen}
                </DarkBtn>
              </>
            )}
          </>
        )}

        {/* ── Save / error ── */}
        {activeTab !== "performer" && (
          <>
            {error && <p className="text-xs" style={{ color: "rgba(252,165,165,0.9)" }}>{error}</p>}
            <DarkBtn full onClick={handleSave} disabled={saving}>
              {saving ? str.edit_saving : isNew ? str.edit_add_confirm : str.edit_save}
            </DarkBtn>
          </>
        )}
      </div>
    </div>
  );
}

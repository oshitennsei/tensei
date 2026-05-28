import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { db } from "@/lib/storage";
import type { Work, Entity, EntityExtended, EntityStateSnapshot, EntityType } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  entity_id: string | null;
  onBack: () => void;
  onSaved: () => void;
}

const ENTITY_TYPES: EntityType[] = ["location", "item", "organization", "concept"];

const BLANK_FORM = {
  canonical_name: "",
  aliases: "",
  description: "",
  type: "location" as EntityType,
  first_appearance: "",
};

const BLANK_SNAP = {
  at_chapter: "",
  state_note: "",
  controller: "",
  holder: "",
  status: "",
};

export function EntityEditScreen({ work, entity_id, onBack, onSaved }: Props) {
  const str = useStrings();
  const isNew = entity_id === null;

  const [form, setForm] = useState(BLANK_FORM);
  const [snapshots, setSnapshots] = useState<EntityStateSnapshot[]>([]);
  const [activeTab, setActiveTab] = useState<"basic" | "history">("basic");
  const [showSnapForm, setShowSnapForm] = useState(false);
  const [snapForm, setSnapForm] = useState(BLANK_SNAP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!entity_id) return;
    (async () => {
      const [entity, ext] = await Promise.all([
        db.entities.get(entity_id),
        db.entities_extended.get(entity_id),
      ]);
      if (entity) {
        setForm({
          canonical_name: entity.canonical_name,
          aliases: entity.aliases.join(", "),
          description: entity.description,
          type: entity.type as EntityType,
          first_appearance: entity.first_appearance?.toString() ?? "",
        });
      }
      if (ext) {
        setSnapshots([...ext.state_snapshots].sort((a, b) => a.at_chapter - b.at_chapter));
      }
    })();
  }, [entity_id]);

  const handleSave = async () => {
    if (!form.canonical_name.trim()) { setError(str.entity_field_name); return; }
    setSaving(true);
    setError("");
    try {
      const aliases = form.aliases.split(",").map(a => a.trim()).filter(Boolean);
      const first_appearance = form.first_appearance ? parseInt(form.first_appearance) : undefined;

      if (isNew) {
        const id = crypto.randomUUID();
        await db.entities.put({
          id,
          work_id: work.id,
          type: form.type,
          canonical_name: form.canonical_name.trim(),
          aliases,
          description: form.description.trim(),
          parent_entities: [],
          child_entities: [],
          first_appearance,
          key_appearances: [],
          linked_entities: [],
        });
        if (snapshots.length > 0) {
          await db.entities_extended.put({ id, work_id: work.id, state_snapshots: snapshots });
        }
      } else {
        await db.entities.update(entity_id!, {
          canonical_name: form.canonical_name.trim(),
          aliases,
          description: form.description.trim(),
          type: form.type,
          first_appearance,
        });
        const existing = await db.entities_extended.get(entity_id!);
        if (existing) {
          await db.entities_extended.update(entity_id!, { state_snapshots: snapshots });
        } else if (snapshots.length > 0) {
          await db.entities_extended.put({ id: entity_id!, work_id: work.id, state_snapshots: snapshots });
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const addSnapshot = () => {
    const ch = parseInt(snapForm.at_chapter);
    if (!ch || !snapForm.state_note.trim()) return;
    const snap: EntityStateSnapshot = {
      at_chapter: ch,
      state_note: snapForm.state_note.trim(),
      controller: snapForm.controller.trim() || undefined,
      holder: snapForm.holder.trim() || undefined,
      status: snapForm.status.trim() || undefined,
    };
    setSnapshots(prev => [...prev, snap].sort((a, b) => a.at_chapter - b.at_chapter));
    setSnapForm(BLANK_SNAP);
    setShowSnapForm(false);
  };

  const deleteSnapshot = (idx: number) => {
    setSnapshots(prev => prev.filter((_, i) => i !== idx));
  };

  const inputCls = "w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400";
  const labelCls = "block text-xs text-gray-600 mb-1";

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold flex-1">
          {isNew ? str.char_add : str.char_edit}
        </h2>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 shrink-0">
        {(["basic", "history"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-indigo-500 text-indigo-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "basic" ? str.entity_tab_basic : str.entity_tab_history}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {activeTab === "basic" && (
          <>
            {/* Type */}
            <div>
              <label className={labelCls}>{str.entity_field_type}</label>
              <select
                className={inputCls}
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as EntityType }))}
              >
                {ENTITY_TYPES.map(t => (
                  <option key={t} value={t}>
                    {str[`entity_type_${t}` as keyof typeof str] as string}
                  </option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div>
              <label className={labelCls}>{str.entity_field_name}</label>
              <input
                className={inputCls}
                placeholder={str.entity_field_name_ph}
                value={form.canonical_name}
                onChange={e => setForm(f => ({ ...f, canonical_name: e.target.value }))}
              />
            </div>

            {/* Aliases */}
            <div>
              <label className={labelCls}>{str.field_aliases}</label>
              <input
                className={inputCls}
                placeholder={str.field_aliases_ph}
                value={form.aliases}
                onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div>
              <label className={labelCls}>{str.field_description}</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* First appearance */}
            <div>
              <label className={labelCls}>{str.entity_field_first_chapter}</label>
              <input
                type="number"
                min={1}
                className={inputCls}
                value={form.first_appearance}
                onChange={e => setForm(f => ({ ...f, first_appearance: e.target.value }))}
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
          </>
        )}

        {activeTab === "history" && (
          <>
            {snapshots.length === 0 && !showSnapForm && (
              <p className="text-xs text-gray-400 text-center mt-6">{str.entity_snap_empty}</p>
            )}

            {snapshots.map((snap, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-1 bg-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-indigo-600">
                    {str.char_first_appear(snap.at_chapter)}
                  </span>
                  <Button variant="danger" size="sm" onClick={() => deleteSnapshot(idx)}>
                    {str.char_delete}
                  </Button>
                </div>
                <p className="text-xs text-gray-700">{snap.state_note}</p>
                {snap.controller && (
                  <p className="text-xs text-gray-500">
                    <span className="text-gray-400">{str.entity_snap_controller}:</span> {snap.controller}
                  </p>
                )}
                {snap.holder && (
                  <p className="text-xs text-gray-500">
                    <span className="text-gray-400">{str.entity_snap_holder}:</span> {snap.holder}
                  </p>
                )}
                {snap.status && (
                  <p className="text-xs text-gray-500">
                    <span className="text-gray-400">{str.entity_snap_status}:</span> {snap.status}
                  </p>
                )}
              </div>
            ))}

            {showSnapForm ? (
              <div className="border border-indigo-200 rounded-lg p-3 space-y-3 bg-indigo-50">
                <div>
                  <label className={labelCls}>{str.entity_snap_chapter}</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={snapForm.at_chapter}
                    onChange={e => setSnapForm(f => ({ ...f, at_chapter: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{str.entity_snap_note}</label>
                  <textarea
                    className={`${inputCls} resize-none`}
                    rows={2}
                    placeholder={str.entity_snap_note_ph}
                    value={snapForm.state_note}
                    onChange={e => setSnapForm(f => ({ ...f, state_note: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{str.entity_snap_controller}</label>
                  <input
                    className={inputCls}
                    value={snapForm.controller}
                    onChange={e => setSnapForm(f => ({ ...f, controller: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{str.entity_snap_holder}</label>
                  <input
                    className={inputCls}
                    value={snapForm.holder}
                    onChange={e => setSnapForm(f => ({ ...f, holder: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{str.entity_snap_status}</label>
                  <input
                    className={inputCls}
                    value={snapForm.status}
                    onChange={e => setSnapForm(f => ({ ...f, status: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => { setShowSnapForm(false); setSnapForm(BLANK_SNAP); }}
                  >
                    {str.edit_cancel}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={addSnapshot}
                    disabled={!snapForm.at_chapter || !snapForm.state_note.trim()}
                  >
                    {str.edit_add_confirm}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setShowSnapForm(true)}>
                {str.entity_snap_add_btn}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 shrink-0">
        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? str.edit_saving : isNew ? str.edit_add_confirm : str.edit_save}
        </Button>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { listPersonas, savePersona, updatePersona, deletePersona } from "@/lib/persona";
import type { Persona } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  onBack: () => void;
}

const BLANK: Omit<Persona, "id"> = {
  name: "",
  language: "ja",
  content_md: "",
  applies_to: ["*"],
  is_default: false,
};

export function PersonaScreen({ onBack }: Props) {
  const str = useStrings();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const reload = async () => setPersonas(await listPersonas());
  useEffect(() => { reload(); }, []);

  const startEdit = (p: Persona) => {
    setEditingId(p.id);
    setForm({ name: p.name, language: p.language ?? "ja", content_md: p.content_md, applies_to: p.applies_to, is_default: p.is_default });
  };

  const cancelEdit = () => { setEditingId(null); setForm(BLANK); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, name: form.name || str.persona_default_name };
      if (editingId) {
        await updatePersona(editingId, data);
      } else {
        await savePersona(data);
      }
      setEditingId(null);
      setForm(BLANK);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deletePersona(id);
    if (editingId === id) cancelEdit();
    await reload();
  };

  const handleSetDefault = async (p: Persona) => {
    await updatePersona(p.id, { is_default: true });
    await reload();
  };

  const isEditing = editingId !== null;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold">{str.persona_title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <p className="text-xs text-gray-400">{str.persona_desc}</p>

        {/* Existing personas */}
        {personas.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">{str.persona_list_title}</h3>
            <ul className="space-y-2">
              {personas.map(p => (
                <li
                  key={p.id}
                  className={`border rounded p-3 text-sm ${
                    editingId === p.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{p.name || str.persona_no_name}</span>
                        {p.is_default && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5">{str.persona_default_badge}</span>
                        )}
                      </div>
                      {p.content_md && (
                        <p className="text-xs text-gray-500 mt-1 truncate">{p.content_md}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!p.is_default && (
                        <Button variant="ghost" size="sm" onClick={() => handleSetDefault(p)}>
                          {str.persona_set_default}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => editingId === p.id ? cancelEdit() : startEdit(p)}>
                        {editingId === p.id ? str.persona_cancel : str.persona_edit}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(p.id)}>{str.persona_delete}</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Form */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase">
            {isEditing ? str.persona_form_editing : str.persona_form_new}
          </h3>

          <div>
            <label className="block text-xs text-gray-600 mb-1">{str.persona_name_label}</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder={str.persona_name_ph}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">{str.persona_content_label}</label>
            <textarea
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
              rows={4}
              placeholder={str.persona_content_ph}
              value={form.content_md}
              onChange={e => setForm(f => ({ ...f, content_md: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_default"
              checked={form.is_default}
              onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
              className="accent-indigo-600"
            />
            <label htmlFor="is_default" className="text-xs text-gray-600">
              {str.persona_default_check}
            </label>
          </div>

          <div className="flex gap-2">
            {isEditing && (
              <Button variant="ghost" onClick={cancelEdit} className="flex-1">{str.persona_cancel}</Button>
            )}
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? str.persona_saving : isEditing ? str.persona_update : str.persona_save}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

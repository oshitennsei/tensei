import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { listPersonas, savePersona, updatePersona, deletePersona } from "@/lib/persona";
import type { Persona, Language } from "@/lib/storage";

interface Props {
  onBack: () => void;
}

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "ja",    label: "日本語" },
  { value: "zh-tw", label: "繁體中文" },
  { value: "zh-cn", label: "简体中文" },
  { value: "zh",    label: "中文（自動）" },
  { value: "en",    label: "English" },
  { value: "ko",    label: "한국어" },
  { value: "other", label: "その他" },
];

const BLANK: Omit<Persona, "id"> = {
  name: "",
  language: "ja",
  content_md: "",
  applies_to: ["*"],
  is_default: false,
};

export function PersonaScreen({ onBack }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const reload = async () => setPersonas(await listPersonas());
  useEffect(() => { reload(); }, []);

  const startEdit = (p: Persona) => {
    setEditingId(p.id);
    setForm({ name: p.name, language: p.language, content_md: p.content_md, applies_to: p.applies_to, is_default: p.is_default });
  };

  const cancelEdit = () => { setEditingId(null); setForm(BLANK); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...form, name: form.name || "デフォルト読者設定" };
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
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold">読者設定</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <p className="text-xs text-gray-400">
          キャラクターへの自己紹介や言語設定を登録できます。複数の設定を作品ごとに切り替えることもできます。
        </p>

        {/* Existing personas */}
        {personas.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">登録済み設定</h3>
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
                        <span className="font-medium">{p.name || "（名前なし）"}</span>
                        {p.is_default && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5">デフォルト</span>
                        )}
                        <span className="text-xs text-gray-400">
                          {LANGUAGE_OPTIONS.find(l => l.value === p.language)?.label ?? p.language}
                        </span>
                      </div>
                      {p.content_md && (
                        <p className="text-xs text-gray-500 mt-1 truncate">{p.content_md}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!p.is_default && (
                        <Button variant="ghost" size="sm" onClick={() => handleSetDefault(p)}>
                          既定に
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => editingId === p.id ? cancelEdit() : startEdit(p)}>
                        {editingId === p.id ? "キャンセル" : "編集"}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(p.id)}>削除</Button>
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
            {isEditing ? "設定を編集" : "新しい設定を追加"}
          </h3>

          <div>
            <label className="block text-xs text-gray-600 mb-1">設定名（任意）</label>
            <input
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder="例: 日本語読者, 中文読者"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">返答言語</label>
            <select
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={form.language}
              onChange={e => setForm(f => ({ ...f, language: e.target.value as Language }))}
            >
              {LANGUAGE_OPTIONS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              キャラクターがこの言語で返答します。
            </p>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">自己紹介・読者プロフィール（任意）</label>
            <textarea
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none"
              rows={4}
              placeholder={"例:\n私はこの小説の熱心なファンです。\nキャラクターたちの日常的な会話を楽しみたいと思っています。"}
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
              すべての作品でこの設定を既定として使う
            </label>
          </div>

          <div className="flex gap-2">
            {isEditing && (
              <Button variant="ghost" onClick={cancelEdit} className="flex-1">キャンセル</Button>
            )}
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "保存中..." : isEditing ? "更新" : "保存"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

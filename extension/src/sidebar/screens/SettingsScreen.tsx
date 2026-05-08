import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import {
  listModels, saveModel, updateModel, deleteModel,
  getRoleAssignments, setRoleAssignment,
  LlmClient, LlmError,
} from "@/lib/llm";
import type { LlmModel, LlmRole } from "@/lib/storage";
import {
  getGlobalBackgroundState, setGlobalBackground, setGlobalBackgroundValue,
  clearGlobalBackground, GRADIENT_PRESETS, DEFAULT_BG,
} from "@/lib/background";
import { useBackground } from "../context/BackgroundContext";

interface Props {
  onBack: () => void;
  onDebug: () => void;
  onPersona: () => void;
}

const ROLES: LlmRole[] = ["main", "sub_agent", "compression", "embedding"];
const ROLE_LABELS: Record<LlmRole, string> = {
  main:        "対話 (main)",
  sub_agent:   "サブエージェント",
  compression: "圧縮",
  embedding:   "埋め込み",
};
const ROLE_DESCRIPTIONS: Record<LlmRole, string> = {
  main:        "キャラクターとの会話",
  sub_agent:   "章解析・人物同定・キーワード抽出",
  compression: "長期記憶の圧縮",
  embedding:   "RAG用ベクトル化",
};

const PRESET_ENDPOINTS = [
  { label: "OpenAI",   url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Ollama",   url: "http://localhost:11434/v1" },
  { label: "ローカル (Transformers.js)", url: "local://transformers" },
];

const LOCAL_EMBED_MODELS = [
  { label: "multilingual-e5-small（推奨）", name: "Xenova/multilingual-e5-small" },
  { label: "paraphrase-multilingual-MiniLM-L12", name: "Xenova/paraphrase-multilingual-MiniLM-L12-v2" },
];

const BLANK_FORM: Omit<LlmModel, "id"> = {
  name: "",
  endpoint_url: "https://api.openai.com/v1",
  api_key: "",
  model_name: "gpt-4o-mini",
  context_window: undefined,
};

type TestState = "idle" | "testing" | "ok" | "fail";

export function SettingsScreen({ onBack, onDebug, onPersona }: Props) {
  const { loadBackground } = useBackground();
  const [models, setModels] = useState<LlmModel[]>([]);
  const [assignments, setAssignments] = useState<Partial<Record<LlmRole, string>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<LlmModel, "id">>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [globalBgState, setGlobalBgState] = useState<{ image: string | null; value: string | null }>({ image: null, value: null });
  const [bgColorInput, setBgColorInput] = useState("#1a1a2e");
  const bgFileRef = useRef<HTMLInputElement>(null);
  const [testMsg, setTestMsg] = useState("");

  const reload = async () => {
    const [ms, as] = await Promise.all([listModels(), getRoleAssignments()]);
    setModels(ms);
    setAssignments(as);
  };
  useEffect(() => {
    reload();
    getGlobalBackgroundState().then(setGlobalBgState);
  }, []);

  const refreshBg = async () => {
    const state = await getGlobalBackgroundState();
    setGlobalBgState(state);
    loadBackground(undefined);
  };

  const handleGlobalBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await setGlobalBackground(file);
      await refreshBg();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleGlobalBgValue = async (value: string) => {
    await setGlobalBackgroundValue(value);
    await refreshBg();
  };

  const handleClearGlobalBg = async () => {
    await clearGlobalBackground();
    await refreshBg();
  };

  const startAdd = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setError("");
    setTestState("idle");
    setTestMsg("");
    setShowForm(true);
  };

  const startEdit = (m: LlmModel) => {
    setEditingId(m.id);
    setForm({ name: m.name, endpoint_url: m.endpoint_url, api_key: m.api_key, model_name: m.model_name, context_window: m.context_window });
    setError("");
    setTestState("idle");
    setTestMsg("");
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(BLANK_FORM);
    setError("");
    setTestState("idle");
  };

  const handleTest = async () => {
    if (!form.endpoint_url || !form.model_name) {
      setError("エンドポイントとモデル名を入力してください。");
      return;
    }
    setTestState("testing");
    setTestMsg("");
    const tempModel: LlmModel = { id: "__test__", ...form };
    const client = new LlmClient(tempModel);
    try {
      await client.complete([{ role: "user", content: "Reply with the single word: ok" }]);
      setTestState("ok");
      setTestMsg("接続成功");
    } catch (e) {
      setTestState("fail");
      setTestMsg(e instanceof LlmError ? e.userMessage : String(e));
    }
  };

  const handleSave = async () => {
    if (!form.endpoint_url || !form.model_name) {
      setError("エンドポイントとモデル名を入力してください。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = { ...form, name: form.name || form.model_name };
      if (editingId) {
        await updateModel(editingId, data);
      } else {
        await saveModel(data);
      }
      cancelForm();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (editingId === id) cancelForm();
    await deleteModel(id);
    await reload();
  };

  const handleRoleChange = async (role: LlmRole, model_id: string) => {
    await setRoleAssignment(role, model_id || null);
    setAssignments(prev => {
      const updated = { ...prev };
      if (model_id) updated[role] = model_id;
      else delete updated[role];
      return updated;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>← 戻る</Button>
        <h2 className="text-sm font-semibold">設定</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* ── Model registry ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">登録済みモデル</h3>
            {!showForm && (
              <Button variant="ghost" size="sm" onClick={startAdd}>＋ 追加</Button>
            )}
          </div>

          {models.length === 0 && !showForm && (
            <p className="text-xs text-gray-400">モデルが登録されていません。</p>
          )}

          {models.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {models.map(m => (
                <li
                  key={m.id}
                  className={`flex items-center justify-between px-3 py-2 rounded border text-sm ${
                    editingId === m.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 text-xs text-gray-400">{m.model_name}</span>
                    {m.context_window && (
                      <span className="ml-1.5 text-xs text-gray-400">{(m.context_window / 1000).toFixed(0)}k ctx</span>
                    )}
                    <div className="text-xs text-gray-400 truncate">{m.endpoint_url}</div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => editingId === m.id ? cancelForm() : startEdit(m)}>
                      {editingId === m.id ? "キャンセル" : "編集"}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(m.id)}>削除</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Add / Edit form */}
          {showForm && (
            <div className="border border-gray-200 rounded p-3 space-y-3">
              <p className="text-xs font-medium text-gray-600">{editingId ? "モデルを編集" : "新規モデルを追加"}</p>

              <div>
                <label className="block text-xs text-gray-500 mb-1">名前（任意）</label>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder="例: GPT-4o"
                  value={form.name}
                  onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setTestState("idle"); }}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">エンドポイント</label>
                <div className="flex gap-1 mb-1 flex-wrap">
                  {PRESET_ENDPOINTS.map(p => (
                    <Button key={p.url} variant="ghost" size="sm"
                      onClick={() => { setForm(f => ({ ...f, endpoint_url: p.url })); setTestState("idle"); }}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  value={form.endpoint_url}
                  onChange={e => { setForm(f => ({ ...f, endpoint_url: e.target.value })); setTestState("idle"); }}
                />
                {form.endpoint_url.startsWith("local://") && (
                  <p className="text-xs text-indigo-600 mt-1">
                    ブラウザ内でモデルを実行。初回使用時にモデルファイルをダウンロード（約60〜100 MB）。APIキー不要。
                  </p>
                )}
              </div>

              {!form.endpoint_url.startsWith("local://") && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">APIキー</label>
                  <input
                    type="password"
                    autoComplete="off"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="sk-..."
                    value={form.api_key}
                    onChange={e => { setForm(f => ({ ...f, api_key: e.target.value })); setTestState("idle"); }}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">モデル名</label>
                {form.endpoint_url.startsWith("local://") && (
                  <div className="flex gap-1 mb-1 flex-wrap">
                    {LOCAL_EMBED_MODELS.map(m => (
                      <Button key={m.name} variant="ghost" size="sm"
                        onClick={() => { setForm(f => ({ ...f, model_name: m.name })); setTestState("idle"); }}>
                        {m.label}
                      </Button>
                    ))}
                  </div>
                )}
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder="gpt-4o-mini"
                  value={form.model_name}
                  onChange={e => { setForm(f => ({ ...f, model_name: e.target.value })); setTestState("idle"); }}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">コンテキストウィンドウ（任意）</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder="例: 128000"
                  value={form.context_window ?? ""}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setForm(f => ({ ...f, context_window: isNaN(v) ? undefined : v }));
                  }}
                />
                <p className="text-xs text-gray-400 mt-0.5">長章節の分割解析に使用。空白の場合はデフォルト（10,000トークン）。</p>
              </div>

              {testState !== "idle" && (
                <p className={`text-xs px-2 py-1.5 rounded ${
                  testState === "ok"      ? "bg-green-50 text-green-700" :
                  testState === "fail"    ? "bg-red-50 text-red-700" :
                                            "bg-gray-50 text-gray-500"
                }`}>
                  {testState === "testing" ? "接続中..." : testMsg}
                </p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex gap-2">
                {!form.endpoint_url.startsWith("local://") && (
                  <Button variant="ghost" size="sm" onClick={handleTest}
                    disabled={testState === "testing" || saving} className="flex-1">
                    接続テスト
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={cancelForm} className="flex-1">キャンセル</Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? "保存中..." : editingId ? "更新" : "保存"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Role assignments ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">ロール割り当て</h3>
          {models.length === 0 ? (
            <p className="text-xs text-gray-400">先にモデルを登録してください。</p>
          ) : (
            <div className="space-y-2">
              {ROLES.map(role => (
                <div key={role} className="flex items-center gap-2">
                  <div className="w-36 shrink-0">
                    <p className="text-xs font-medium text-gray-700">{ROLE_LABELS[role]}</p>
                    <p className="text-xs text-gray-400">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                  <select
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={assignments[role] ?? ""}
                    onChange={e => handleRoleChange(role, e.target.value)}
                  >
                    <option value="">— 未設定 —</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.model_name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Appearance ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">外観</h3>
          <p className="text-xs text-gray-400 mb-2">全作品共通の背景（作品ごとに上書き可能）</p>
          <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalBgUpload} />

          {/* Current preview */}
          <div
            className="w-full h-14 rounded mb-2 flex items-center justify-center relative overflow-hidden"
            style={{ background: globalBgState.image ? `url(${globalBgState.image}) center/cover no-repeat` : (globalBgState.value ?? DEFAULT_BG) }}
          >
            {!globalBgState.image && !globalBgState.value && (
              <span className="text-white/60 text-xs">デフォルト（深夜の書斎）</span>
            )}
            {(globalBgState.image || globalBgState.value) && (
              <button
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs leading-none"
                onClick={handleClearGlobalBg}
                title="リセット（デフォルトに戻す）"
              >×</button>
            )}
          </div>

          {/* Options */}
          <div className="space-y-2">
            {/* Image upload */}
            <Button variant="ghost" size="sm" className="w-full" onClick={() => bgFileRef.current?.click()}>
              {globalBgState.image ? "画像を変更" : "+ 画像をアップロード"}
            </Button>

            {/* Gradient presets */}
            <div>
              <p className="text-xs text-gray-400 mb-1">グラデーション</p>
              <div className="grid grid-cols-2 gap-1">
                {GRADIENT_PRESETS.map(p => (
                  <button
                    key={p.value}
                    className={`h-8 rounded text-xs text-white/80 transition-all hover:ring-2 ring-white/40 ${
                      globalBgState.value === p.value && !globalBgState.image ? "ring-2 ring-white/60" : ""
                    }`}
                    style={{ background: p.value }}
                    onClick={() => handleGlobalBgValue(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Solid color */}
            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 shrink-0">単色</p>
              <input
                type="color"
                className="w-8 h-6 rounded cursor-pointer border border-gray-300"
                value={bgColorInput}
                onChange={e => setBgColorInput(e.target.value)}
              />
              <Button variant="ghost" size="sm" onClick={() => handleGlobalBgValue(bgColorInput)}>
                適用
              </Button>
            </div>
          </div>
        </section>

        {/* ── Reader persona ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">読者設定</h3>
          <Button variant="ghost" className="w-full text-left" onClick={onPersona}>
            読者プロフィール・言語設定 →
          </Button>
        </section>

        {/* ── Data management ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">データ管理</h3>
          <Button variant="ghost" className="w-full text-left" onClick={onDebug}>
            解析データを確認 →
          </Button>
        </section>

      </div>
    </div>
  );
}

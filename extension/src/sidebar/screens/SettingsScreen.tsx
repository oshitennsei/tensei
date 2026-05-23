import { useState, useEffect, useRef } from "react";
import { Button } from "../components/Button";
import {
  listModels, saveModel, updateModel, deleteModel,
  getRoleAssignments, setRoleAssignment,
  LlmClient, LlmError,
} from "@/lib/llm";
import type { LlmModel, LlmRole, Language } from "@/lib/storage";
import {
  getGlobalBackgroundState, setGlobalBackground, setGlobalBackgroundValue,
  clearGlobalBackground, GRADIENT_PRESETS, DEFAULT_BG,
} from "@/lib/background";
import { useBackground } from "../context/BackgroundContext";
import { db } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

function AboutSection() {
  const str = useStrings();
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">{str.settings_about_section}</h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-700">{__APP_VERSION__}</span>
          <button
            className="text-xs text-indigo-500 hover:underline"
            onClick={() => setOpen(v => !v)}
          >
            {open ? str.settings_about_hide : str.settings_about_show}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-3">
          <div className="space-y-1 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>{str.settings_license}</span>
              <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">GNU GPL v3.0</a>
            </div>
            <div className="flex justify-between">
              <span>{str.settings_source}</span>
              <a href="https://github.com/Chakotay-Lee/tensei" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">GitHub</a>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5">{str.settings_libs}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-400">
              <span>React 18</span><span className="text-right">MIT</span>
              <span>Dexie.js</span><span className="text-right">Apache 2.0</span>
              <span>@huggingface/transformers</span><span className="text-right">Apache 2.0</span>
              <span>Vite</span><span className="text-right">MIT</span>
              <span>Tailwind CSS</span><span className="text-right">MIT</span>
              <span>TypeScript</span><span className="text-right">Apache 2.0</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface Props {
  onBack: () => void;
  onDebug: () => void;
  onPersona: () => void;
}

const ROLES: LlmRole[] = ["main", "sub_agent", "plan", "scene", "compression", "embedding"];

const PRESET_ENDPOINTS = [
  { label: "OpenAI",   url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta" },
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

const UI_LANG_NAMES: Partial<Record<Language, string>> = {
  "ja":    "日本語",
  "zh-tw": "繁體中文",
  "zh-cn": "简体中文",
  "en":    "English",
};

type TestState = "idle" | "testing" | "ok" | "fail";

export function SettingsScreen({ onBack, onDebug, onPersona }: Props) {
  const str = useStrings();
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
  const [planMaxLoops, setPlanMaxLoops] = useState(3);
  const [planDebugMode, setPlanDebugMode] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<Language>("ja");

  const ROLE_LABELS: Record<LlmRole, string> = {
    main:        str.settings_role_main,
    sub_agent:   str.settings_role_sub,
    plan:        str.settings_role_plan,
    scene:       str.settings_role_scene,
    compression: str.settings_role_compress,
    embedding:   str.settings_role_embed,
  };
  const ROLE_DESCRIPTIONS: Record<LlmRole, string> = {
    main:        str.settings_role_main_desc,
    sub_agent:   str.settings_role_sub_desc,
    plan:        str.settings_role_plan_desc,
    scene:       str.settings_role_scene_desc,
    compression: str.settings_role_compress_desc,
    embedding:   str.settings_role_embed_desc,
  };

  const reload = async () => {
    const [ms, as, appSettings] = await Promise.all([listModels(), getRoleAssignments(), db.app_settings.get("global")]);
    setModels(ms);
    setAssignments(as);
    if (appSettings) {
      setPlanMaxLoops(appSettings.plan_max_loops ?? 3);
      setPlanDebugMode(appSettings.plan_debug_mode ?? false);
      setUiLanguage(appSettings.ui_language ?? "ja");
    }
  };
  useEffect(() => {
    reload();
    getGlobalBackgroundState().then(setGlobalBgState);
  }, []);

  const savePlanSettings = async (maxLoops: number, debugMode: boolean) => {
    const existing = await db.app_settings.get("global");
    if (existing) {
      await db.app_settings.update("global", { plan_max_loops: maxLoops, plan_debug_mode: debugMode });
    } else {
      await db.app_settings.add({ id: "global", plan_max_loops: maxLoops, plan_debug_mode: debugMode });
    }
  };

  const saveUILanguage = async (lang: Language) => {
    const existing = await db.app_settings.get("global");
    if (existing) {
      await db.app_settings.update("global", { ui_language: lang });
    } else {
      await db.app_settings.add({ id: "global", ui_language: lang });
    }
  };

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
      setError(str.settings_error_endpoint);
      return;
    }
    setTestState("testing");
    setTestMsg("");
    const tempModel: LlmModel = { id: "__test__", ...form };
    const client = new LlmClient(tempModel);
    try {
      await client.complete([{ role: "user", content: "Reply with the single word: ok" }]);
      setTestState("ok");
      setTestMsg(str.settings_test_ok);
    } catch (e) {
      setTestState("fail");
      setTestMsg(e instanceof LlmError ? e.userMessage : String(e));
    }
  };

  const handleSave = async () => {
    if (!form.endpoint_url || !form.model_name) {
      setError(str.settings_error_endpoint);
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
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold">{str.settings_title}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* ── Model registry ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">{str.settings_models_section}</h3>
            {!showForm && (
              <Button variant="ghost" size="sm" onClick={startAdd}>{str.settings_add_model}</Button>
            )}
          </div>

          {models.length === 0 && !showForm && (
            <p className="text-xs text-gray-400">{str.settings_no_models}</p>
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
                      {editingId === m.id ? str.settings_cancel : str.settings_edit}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(m.id)}>{str.settings_delete}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Add / Edit form */}
          {showForm && (
            <div className="border border-gray-200 rounded p-3 space-y-3">
              <p className="text-xs font-medium text-gray-600">{editingId ? str.settings_form_edit_title : str.settings_form_new_title}</p>

              <div>
                <label className="block text-xs text-gray-500 mb-1">{str.settings_field_name}</label>
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder={str.settings_field_name_ph}
                  value={form.name}
                  onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setTestState("idle"); }}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">{str.settings_field_endpoint}</label>
                <div className="flex gap-1 mb-1 flex-wrap">
                  {PRESET_ENDPOINTS.map(p => (
                    <Button key={p.url} variant="ghost" size="sm"
                      onClick={() => { setForm(f => ({ ...f, endpoint_url: p.url, ...(p.url.startsWith("local://") && { model_name: LOCAL_EMBED_MODELS[0].name }) })); setTestState("idle"); }}>
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
                  <p className="text-xs text-indigo-600 mt-1">{str.settings_local_note}</p>
                )}
              </div>

              {!form.endpoint_url.startsWith("local://") && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{str.settings_field_apikey}</label>
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
                <label className="block text-xs text-gray-500 mb-1">{str.settings_field_model}</label>
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
                <label className="block text-xs text-gray-500 mb-1">{str.settings_field_context}</label>
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
                <p className="text-xs text-gray-400 mt-0.5">{str.settings_context_note}</p>
              </div>

              {testState !== "idle" && (
                <p className={`text-xs px-2 py-1.5 rounded ${
                  testState === "ok"   ? "bg-green-50 text-green-700" :
                  testState === "fail" ? "bg-red-50 text-red-700" :
                                         "bg-gray-50 text-gray-500"
                }`}>
                  {testState === "testing" ? str.settings_testing : testMsg}
                </p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex gap-2">
                {!form.endpoint_url.startsWith("local://") && (
                  <Button variant="ghost" size="sm" onClick={handleTest}
                    disabled={testState === "testing" || saving} className="flex-1">
                    {str.settings_test_btn}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={cancelForm} className="flex-1">{str.settings_cancel}</Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                  {saving ? str.settings_saving : editingId ? str.settings_update : str.settings_save}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Role assignments ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.settings_roles_section}</h3>
          {models.length === 0 ? (
            <p className="text-xs text-gray-400">{str.settings_no_models_roles}</p>
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
                    <option value="">{str.settings_unassigned}</option>
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
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.settings_appearance}</h3>
          <p className="text-xs text-gray-400 mb-2">{str.settings_appearance_desc}</p>
          <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleGlobalBgUpload} />

          <div
            className="w-full h-14 rounded mb-2 flex items-center justify-center relative overflow-hidden"
            style={{ background: globalBgState.image ? `url(${globalBgState.image}) center/cover no-repeat` : (globalBgState.value ?? DEFAULT_BG) }}
          >
            {!globalBgState.image && !globalBgState.value && (
              <span className="text-white/60 text-xs">{str.settings_bg_default_label}</span>
            )}
            {(globalBgState.image || globalBgState.value) && (
              <button
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs leading-none"
                onClick={handleClearGlobalBg}
              >×</button>
            )}
          </div>

          <div className="space-y-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => bgFileRef.current?.click()}>
              {globalBgState.image ? str.settings_bg_change : str.settings_bg_upload}
            </Button>

            <div>
              <p className="text-xs text-gray-400 mb-1">{str.settings_bg_gradient}</p>
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

            <div className="flex items-center gap-2">
              <p className="text-xs text-gray-400 shrink-0">{str.settings_bg_solid}</p>
              <input
                type="color"
                className="w-8 h-6 rounded cursor-pointer border border-gray-300"
                value={bgColorInput}
                onChange={e => setBgColorInput(e.target.value)}
              />
              <Button variant="ghost" size="sm" onClick={() => handleGlobalBgValue(bgColorInput)}>
                {str.settings_bg_apply}
              </Button>
            </div>
          </div>
        </section>

        {/* ── Reader persona ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.settings_persona_section}</h3>
          <Button variant="ghost" className="w-full text-left" onClick={onPersona}>
            {str.settings_persona_link}
          </Button>
        </section>

        {/* ── Data management ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.settings_data_section}</h3>
          <Button variant="ghost" className="w-full text-left" onClick={onDebug}>
            {str.settings_data_link}
          </Button>
        </section>

        {/* ── Language ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{str.settings_lang_label}</h3>
          <div className="flex gap-2 flex-wrap">
            {(["ja", "zh-tw", "zh-cn", "en"] as Language[]).map(lang => (
              <button
                key={lang}
                className={`px-4 py-1.5 text-sm rounded border transition-colors ${
                  uiLanguage === lang
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-300 text-gray-700 hover:border-indigo-400"
                }`}
                onClick={() => {
                  setUiLanguage(lang);
                  saveUILanguage(lang);
                }}
              >
                {UI_LANG_NAMES[lang] ?? lang}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{str.settings_lang_desc}</p>
        </section>

        {/* ── Production plan settings ── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">{str.settings_plan_section}</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700">{str.settings_plan_loops}</p>
                <p className="text-xs text-gray-400">{str.settings_plan_loops_desc}</p>
              </div>
              <input
                type="number"
                min={1}
                max={20}
                className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={planMaxLoops}
                onChange={e => {
                  const v = Math.max(1, Math.min(20, Number(e.target.value)));
                  setPlanMaxLoops(v);
                  savePlanSettings(v, planDebugMode);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-700">{str.settings_plan_debug}</p>
                <p className="text-xs text-gray-400">{str.settings_plan_debug_desc}</p>
              </div>
              <button
                className={`w-10 h-6 rounded-full transition-colors ${planDebugMode ? "bg-indigo-600" : "bg-gray-300"}`}
                onClick={() => {
                  const next = !planDebugMode;
                  setPlanDebugMode(next);
                  savePlanSettings(planMaxLoops, next);
                }}
              >
                <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${planDebugMode ? "translate-x-4" : ""}`} />
              </button>
            </div>
          </div>
        </section>

        {/* ── About ── */}
        <AboutSection />

      </div>
    </div>
  );
}

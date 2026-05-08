import { useState, useRef } from "react";
import { Button } from "../components/Button";
import { updatePlan } from "@/lib/performance";
import type { Work, PerformanceSession, ProductionPlan } from "@/lib/storage";

interface Props {
  work: Work;
  session: PerformanceSession;
  plan: ProductionPlan;
  onBack: () => void;
  onStart: (plan: ProductionPlan) => void;
}

type PlanTextField = "where" | "when" | "what" | "why" | "how";

const FIELD_LABELS: Record<PlanTextField, string> = {
  where: "どこで (Where)",
  when:  "いつ (When)",
  what:  "何が起きる (What)",
  why:   "なぜ (Why)",
  how:   "どのように (How)",
};

export function ProductionPlanScreen({ work: _work, session: _session, plan, onBack, onStart }: Props) {
  const [localPlan, setLocalPlan] = useState<ProductionPlan>({ ...plan });
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [newProp, setNewProp] = useState("");
  const [newTag, setNewTag] = useState("");
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const persist = async (updates: Partial<ProductionPlan>) => {
    const updated = { ...localPlan, ...updates };
    setLocalPlan(updated);
    await updatePlan(localPlan.id, updates);
  };

  // Beat drag handlers
  const handleDragStart = (idx: number) => { dragIndexRef.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(idx);
  };
  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOver(null);
    const from = dragIndexRef.current;
    if (from === null || from === idx) return;
    const next = [...localPlan.beats];
    const [item] = next.splice(from, 1);
    next.splice(idx, 0, item);
    const renumbered = next.map((b, i) => ({ ...b, order: i + 1 }));
    persist({ beats: renumbered });
    dragIndexRef.current = null;
  };
  const handleDragEnd = () => { setDragOver(null); dragIndexRef.current = null; };

  const textFields: PlanTextField[] = ["where", "when", "what", "why", "how"];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <p className="text-sm font-semibold flex-1">演出計画</p>
        <Button size="sm" onClick={() => onStart(localPlan)}>
          演出開始 →
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* ① 5W セクション */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-3">5W1H</p>

          {/* who — chips display */}
          <div className="border-b border-gray-100 pb-3 mb-3">
            <p className="text-xs font-semibold text-gray-500 mb-1">登場人物 (Who)</p>
            <div className="flex flex-wrap gap-1">
              {localPlan.who.map(name => (
                <span
                  key={name}
                  className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full"
                >
                  {name}
                </span>
              ))}
              {localPlan.who.length === 0 && (
                <span className="text-xs text-gray-300">（未入力）</span>
              )}
            </div>
          </div>

          {/* editable text fields */}
          {textFields.map(key => (
            <div key={key} className="border-b border-gray-100 pb-3 mb-3 last:border-0 last:mb-0 last:pb-0">
              <p className="text-xs font-semibold text-gray-500 mb-1">{FIELD_LABELS[key]}</p>
              {editingField === key ? (
                <textarea
                  className="w-full border border-indigo-400 rounded px-2 py-1 text-sm resize-none focus:outline-none"
                  rows={2}
                  value={localPlan[key]}
                  onChange={e => setLocalPlan(p => ({ ...p, [key]: e.target.value }))}
                  onBlur={() => {
                    persist({ [key]: localPlan[key] });
                    setEditingField(null);
                  }}
                  autoFocus
                />
              ) : (
                <p
                  className="text-sm text-gray-800 cursor-pointer hover:text-indigo-600"
                  onClick={() => setEditingField(key)}
                >
                  {localPlan[key] ? (
                    <>
                      {localPlan[key]}
                      <span className="text-xs text-gray-300 ml-1">✎</span>
                    </>
                  ) : (
                    <span className="text-gray-300">（未入力）<span className="text-xs ml-1">✎</span></span>
                  )}
                </p>
              )}
            </div>
          ))}
        </section>

        {/* ② 道具 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">道具</p>
          <div className="flex flex-wrap gap-1 mb-1">
            {localPlan.props.map(prop => (
              <span
                key={prop}
                className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              >
                {prop}
                <button
                  className="text-gray-400 hover:text-red-400 leading-none"
                  onClick={() => persist({ props: localPlan.props.filter(x => x !== prop) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-1">
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="道具を追加..."
              value={newProp}
              onChange={e => setNewProp(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newProp.trim()) {
                  persist({ props: [...localPlan.props, newProp.trim()] });
                  setNewProp("");
                }
              }}
            />
          </div>
        </section>

        {/* トーン */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">トーン</p>
          <div className="flex flex-wrap gap-1 mb-1">
            {localPlan.tone_tags.map(tag => (
              <span
                key={tag}
                className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              >
                {tag}
                <button
                  className="text-indigo-400 hover:text-red-400 leading-none"
                  onClick={() => persist({ tone_tags: localPlan.tone_tags.filter(x => x !== tag) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-1">
            <input
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="トーンを追加..."
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newTag.trim()) {
                  persist({ tone_tags: [...localPlan.tone_tags, newTag.trim()] });
                  setNewTag("");
                }
              }}
            />
          </div>
        </section>

        {/* ③ 幕の流れ */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">幕の流れ</p>
          <ul className="space-y-0.5">
            {localPlan.beats.map((beat, idx) => (
              <li
                key={idx}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDrop={e => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 py-1 px-1 rounded border transition-colors ${
                  dragOver === idx
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-transparent"
                }`}
              >
                <span className="text-gray-300 text-xs select-none cursor-grab">⠿</span>
                <span className="text-xs text-gray-400 w-5 shrink-0">{beat.order}.</span>
                {editingBeat === idx ? (
                  <input
                    className="flex-1 border border-indigo-400 rounded px-1 py-0.5 text-xs focus:outline-none"
                    value={beat.description}
                    onChange={e => {
                      const newBeats = localPlan.beats.map((b, i) =>
                        i === idx ? { ...b, description: e.target.value } : b
                      );
                      setLocalPlan(p => ({ ...p, beats: newBeats }));
                    }}
                    onBlur={() => {
                      persist({ beats: localPlan.beats });
                      setEditingBeat(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="flex-1 text-xs text-gray-700 cursor-pointer hover:text-indigo-600"
                    onClick={() => setEditingBeat(idx)}
                  >
                    {beat.description || <span className="text-gray-300">（未入力）</span>}
                  </span>
                )}
                <button
                  className="text-gray-300 hover:text-red-400 text-xs shrink-0"
                  onClick={() => {
                    const newBeats = localPlan.beats
                      .filter((_, i) => i !== idx)
                      .map((b, i) => ({ ...b, order: i + 1 }));
                    persist({ beats: newBeats });
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            onClick={() =>
              persist({
                beats: [
                  ...localPlan.beats,
                  { order: localPlan.beats.length + 1, description: "" },
                ],
              })
            }
          >
            + 幕を追加
          </button>
        </section>

        {/* ④ メモ欄 */}
        <section>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">メモ</p>
          <textarea
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={3}
            placeholder="追加メモや補足..."
            value={localPlan.user_notes ?? ""}
            onChange={e => setLocalPlan(p => ({ ...p, user_notes: e.target.value }))}
            onBlur={() => persist({ user_notes: localPlan.user_notes })}
          />
        </section>

      </div>

      <div className="border-t border-gray-200 p-4 shrink-0">
        <Button className="w-full" onClick={() => onStart(localPlan)}>
          演出を開始 →
        </Button>
      </div>
    </div>
  );
}

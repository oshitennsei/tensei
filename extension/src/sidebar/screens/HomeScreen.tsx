import { useState, useEffect } from "react";
import { listWorks } from "@/lib/ingestion";
import type { Work } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  onSelectWork: (work: Work) => void;
  onIngest: () => void;
  onSettings: () => void;
  onWorkRegister: () => void;
  onGuide: () => void;
}

// ─── Palette (matches 転生学校) ──────────────────────────────────────────────
const C = {
  bg:          "#080a14",
  cardBg:      "rgba(13,13,36,0.8)",
  border:      "rgba(99,102,241,0.18)",
  borderHover: "rgba(99,102,241,0.48)",
  gold:        "#d4af37",
  indigo:      "#818cf8",
  text:        "#e2e8f0",
  muted:       "#4b5563",
};

function IconBtn({ onClick, icon, title }: { onClick: () => void; icon: string; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all duration-200"
      style={{ color: C.muted }}
      onMouseEnter={e => {
        e.currentTarget.style.color = C.indigo;
        e.currentTarget.style.background = "rgba(99,102,241,0.1)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = C.muted;
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
    </button>
  );
}

function WorkCard({ work, onSelect, idx }: { work: Work; onSelect: (w: Work) => void; idx: number }) {
  return (
    <li style={{ animation: `tn-fadein 0.35s ${idx * 0.05}s both ease-out` }}>
      <button
        onClick={() => onSelect(work)}
        className="w-full text-left rounded-xl px-4 py-3.5 flex items-center gap-3 transition-all duration-200"
        style={{ background: C.cardBg, border: `1px solid ${C.border}` }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = C.borderHover;
          e.currentTarget.style.boxShadow = "0 0 18px rgba(99,102,241,0.12), inset 0 0 24px rgba(99,102,241,0.03)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = C.border;
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.transform = "none";
        }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-base shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.15))",
            border: "1px solid rgba(99,102,241,0.35)",
            color: C.indigo,
            textShadow: "0 0 10px rgba(99,102,241,0.5)",
          }}
        >
          {work.title.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" style={{ color: C.text }}>{work.title}</p>
          {work.author && (
            <p className="text-xs truncate mt-0.5" style={{ color: C.muted }}>{work.author}</p>
          )}
        </div>
        <span className="shrink-0 text-sm" style={{ color: "rgba(99,102,241,0.4)" }}>›</span>
      </button>
    </li>
  );
}

function EmptyState({ str, onIngest }: { str: ReturnType<typeof useStrings>; onIngest: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-5"
        style={{
          background: "rgba(99,102,241,0.07)",
          border: `1px solid ${C.border}`,
          animation: "tn-pulse 3s ease-in-out infinite",
        }}
      >
        📖
      </div>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: C.muted }}>{str.home_empty}</p>
      <button
        onClick={onIngest}
        className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
        style={{
          background: "rgba(99,102,241,0.1)",
          border: `1px solid ${C.border}`,
          color: C.indigo,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(99,102,241,0.2)";
          e.currentTarget.style.borderColor = C.borderHover;
          e.currentTarget.style.boxShadow = "0 0 16px rgba(99,102,241,0.15)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(99,102,241,0.1)";
          e.currentTarget.style.borderColor = C.border;
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {str.home_cta}
      </button>
    </div>
  );
}

export function HomeScreen({ onSelectWork, onIngest, onSettings, onWorkRegister, onGuide }: Props) {
  const str = useStrings();
  const [works, setWorks] = useState<Work[]>([]);

  useEffect(() => { listWorks().then(setWorks); }, []);

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg }}>
      <header
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid rgba(99,102,241,0.12)", background: "rgba(8,10,20,0.95)" }}
      >
        <span
          className="text-sm font-bold tracking-widest"
          style={{ color: C.gold, animation: "tn-glow 4s ease-in-out infinite" }}
        >
          転生
        </span>
        <div className="flex gap-0.5">
          <IconBtn onClick={onGuide}        icon="🎓" title={str.home_guide_btn} />
          <IconBtn onClick={onWorkRegister} icon="✍️" title={str.author_verify_btn} />
          <IconBtn onClick={onIngest}       icon="＋" title={str.home_ingest_btn} />
          <IconBtn onClick={onSettings}     icon="⚙" title={str.home_settings_btn} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {works.length === 0 ? (
          <EmptyState str={str} onIngest={onIngest} />
        ) : (
          <ul className="p-3 space-y-2">
            {works.map((w, i) => (
              <WorkCard key={w.id} work={w} onSelect={onSelectWork} idx={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

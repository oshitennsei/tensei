import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/storage";
import type { Work, Entity, CharacterExtended, GlossaryEntry } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg:          "#080a14",
  cardBg:      "rgba(13,13,36,0.82)",
  border:      "rgba(99,102,241,0.18)",
  borderHover: "rgba(99,102,241,0.45)",
  indigo:      "#818cf8",
  indigoDim:   "rgba(99,102,241,0.12)",
  text:        "#e2e8f0",
  muted:       "#64748b",
  mutedLight:  "#94a3b8",
  danger:      "rgba(239,68,68,0.85)",
};

function charHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function IconBtn({ onClick, icon, title }: { onClick: () => void; icon: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all duration-150"
      style={{ color: C.muted }}
      onMouseEnter={e => { e.currentTarget.style.color = C.indigo; e.currentTarget.style.background = C.indigoDim; }}
      onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
    </button>
  );
}

function Badge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded-full font-medium"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      {label}
    </span>
  );
}

interface Props {
  work: Work;
  onBack: () => void;
  onEdit: (character_id: string) => void;
  onAdd: () => void;
}

function deriveAuthorizationUrl(charUrl: string): string | null {
  const match = charUrl.match(
    /^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/tensei-authors\/[^/]+\/works\/[^/]+)\/characters\/[^/]+\.json$/
  );
  if (!match) return null;
  return `${match[1]}/authorization.json`;
}

export function CharacterScreen({ work, onBack, onEdit, onAdd }: Props) {
  const str = useStrings();
  const [characters, setCharacters] = useState<Entity[]>([]);
  const [extIds, setExtIds] = useState<Set<string>>(new Set());
  const [authorProvidedIds, setAuthorProvidedIds] = useState<Set<string>>(new Set());
  const [verifiedWorkIds, setVerifiedWorkIds] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState("");
  const [importOk, setImportOk] = useState("");
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const [chars, exts, auths] = await Promise.all([
      db.entities.where("work_id").equals(work.id).filter(e => e.type === "character").toArray(),
      db.characters_extended.where("work_id").equals(work.id).toArray(),
      db.authorizations_local.toArray(),
    ]);
    setCharacters(chars.sort((a, b) => (a.first_appearance ?? 99) - (b.first_appearance ?? 99)));
    setExtIds(new Set(exts.map(e => e.id)));
    setAuthorProvidedIds(new Set(exts.filter(e => e.author_provided).map(e => e.id)));
    setVerifiedWorkIds(new Set(
      auths.filter(a => a.status === "active" && a.work_identifier === work.id).map(a => a.work_identifier)
    ));
  };

  useEffect(() => { reload(); }, [work.id]);

  const handleDelete = async (id: string) => {
    if (!confirm(str.char_delete_confirm)) return;
    await db.transaction("rw", [db.entities, db.characters_extended], async () => {
      await db.entities.delete(id);
      await db.characters_extended.delete(id);
    });
    reload();
  };

  const importFromJson = async (json: Record<string, unknown>) => {
    const name = String(json.canonical_name ?? "").trim();
    if (!name) { setImportError(str.char_no_canonical); return; }

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

    setImportOk(str.char_imported(name));
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
      setImportError(str.char_json_error); return;
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
      if (!res.ok) { setImportError(str.char_fetch_fail(res.status)); return; }
      let json: Record<string, unknown>;
      try {
        json = await res.json();
      } catch {
        setImportError(str.char_json_error); return;
      }
      await importFromJson(json);

      const authUrl = deriveAuthorizationUrl(url);
      if (authUrl) {
        try {
          const authRes = await fetch(authUrl);
          if (authRes.ok) {
            const authRecord = await authRes.json() as Record<string, unknown>;
            const status = (authRecord.status as string) ?? "active";
            await db.authorizations_local.put({
              work_identifier: work.id,
              full_authorization_record: authRecord,
              last_synced_at: Date.now(),
              status: status as "active" | "suspended" | "revoked",
            });
          }
        } catch {
          // Best-effort
        }
      }

      setUrlInput("");
      setShowUrlImport(false);
    } catch (err) {
      setImportError(str.char_fetch_error(String(err)));
    } finally {
      setUrlImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg, color: C.text }}>
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />

      {/* ── Header ── */}
      <header
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(8,10,20,0.97)" }}
      >
        <IconBtn onClick={onBack} icon="←" />
        <h2 className="flex-1 text-sm font-semibold truncate" style={{ color: C.text }}>
          {str.char_mgmt_title}
        </h2>
        <IconBtn
          onClick={() => { setShowUrlImport(p => !p); setImportError(""); setImportOk(""); }}
          icon="🔗"
          title={str.char_url_import}
        />
        <IconBtn
          onClick={() => fileInputRef.current?.click()}
          icon="📂"
          title={str.char_json_import}
        />
        <button
          onClick={onAdd}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
          style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "white" }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
        >
          ＋ {str.char_add}
        </button>
      </header>

      {/* ── URL import bar ── */}
      {showUrlImport && (
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ background: "rgba(13,13,36,0.92)", borderBottom: `1px solid ${C.border}` }}
        >
          <input
            className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${C.border}`,
              color: C.text,
            }}
            placeholder="GitHub raw URL"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleUrlImport(); }}
            onFocus={e => { e.currentTarget.style.borderColor = C.indigo; }}
            onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
          />
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
            style={{ background: C.indigoDim, border: `1px solid ${C.border}`, color: C.indigo }}
            onClick={handleUrlImport}
            disabled={urlImporting || !urlInput.trim()}
            onMouseEnter={e => { if (!urlImporting) e.currentTarget.style.background = "rgba(99,102,241,0.22)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.indigoDim; }}
          >
            {urlImporting ? str.char_loading : str.char_load_btn}
          </button>
        </div>
      )}

      {/* ── Status message ── */}
      {(importError || importOk) && (
        <div
          className="mx-3 mt-2 px-3 py-2 rounded-lg text-xs shrink-0"
          style={{
            background: importError ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
            border: `1px solid ${importError ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)"}`,
            color: importError ? "rgba(252,165,165,0.9)" : "rgba(110,231,183,0.9)",
          }}
        >
          {importError || importOk}
        </div>
      )}

      {/* ── Character list ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {characters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full pb-16 gap-3">
            <div className="text-4xl opacity-20">👥</div>
            <p className="text-sm" style={{ color: C.muted }}>{str.char_empty}</p>
            <p className="text-xs" style={{ color: C.muted }}>{str.char_empty_desc}</p>
          </div>
        ) : (
          characters.map(c => {
            const hue = charHue(c.id);
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150"
                style={{ background: C.cardBg, border: `1px solid ${C.border}` }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderHover; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}
              >
                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold shrink-0"
                  style={{
                    background: `hsl(${hue},40%,16%)`,
                    border: `1.5px solid hsl(${hue},50%,32%)`,
                    color: `hsl(${hue},70%,68%)`,
                  }}
                >
                  {c.canonical_name.slice(0, 1)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.text }}>
                    {c.canonical_name}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {c.first_appearance != null && (
                      <span className="text-xs" style={{ color: C.muted }}>
                        {str.char_first_appear(c.first_appearance)}
                      </span>
                    )}
                    {authorProvidedIds.has(c.id) && verifiedWorkIds.size > 0 && (
                      <Badge
                        label={str.char_verified}
                        color="rgba(110,231,183,0.95)"
                        bg="rgba(16,185,129,0.12)"
                        border="rgba(16,185,129,0.28)"
                      />
                    )}
                    {authorProvidedIds.has(c.id) && (
                      <Badge
                        label={str.char_official}
                        color={C.indigo}
                        bg={C.indigoDim}
                        border="rgba(99,102,241,0.28)"
                      />
                    )}
                    {!extIds.has(c.id) && (
                      <Badge
                        label={str.char_no_persona}
                        color="rgba(251,191,36,0.9)"
                        bg="rgba(245,158,11,0.1)"
                        border="rgba(245,158,11,0.25)"
                      />
                    )}
                  </div>
                  {c.description && (
                    <p className="text-xs truncate mt-0.5" style={{ color: C.muted }}>
                      {c.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-all"
                    style={{ color: C.muted }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.indigo; e.currentTarget.style.background = C.indigoDim; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
                    onClick={() => onEdit(c.id)}
                    title={str.char_edit}
                  >
                    ✎
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition-all"
                    style={{ color: C.muted }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent"; }}
                    onClick={() => handleDelete(c.id)}
                    title={str.char_delete}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

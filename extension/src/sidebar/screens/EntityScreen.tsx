import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { db } from "@/lib/storage";
import type { Work, Entity, EntityType } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  onBack: () => void;
  onEdit: (entity_id: string) => void;
  onAdd: () => void;
}

const NON_CHAR_TYPES: EntityType[] = ["location", "item", "organization", "concept"];

export function EntityScreen({ work, onBack, onEdit, onAdd }: Props) {
  const str = useStrings();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");
  const [query, setQuery] = useState("");

  const reload = async () => {
    const all = await db.entities
      .where("work_id").equals(work.id)
      .filter(e => e.type !== "character")
      .toArray();
    setEntities(all.sort((a, b) => (a.first_appearance ?? 9999) - (b.first_appearance ?? 9999)));
  };

  useEffect(() => { reload(); }, [work.id]);

  const handleDelete = async (id: string) => {
    if (!confirm(str.entity_delete_confirm)) return;
    await db.entities.delete(id);
    reload();
  };

  const typeLabel = (t: EntityType): string => {
    switch (t) {
      case "location": return str.entity_type_location;
      case "item": return str.entity_type_item;
      case "organization": return str.entity_type_organization;
      case "concept": return str.entity_type_concept;
      default: return t;
    }
  };

  const typeColor = (t: EntityType): string => {
    switch (t) {
      case "location": return "bg-green-100 text-green-700";
      case "item": return "bg-amber-100 text-amber-700";
      case "organization": return "bg-blue-100 text-blue-700";
      case "concept": return "bg-purple-100 text-purple-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const filtered = entities.filter(e => {
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        e.canonical_name.toLowerCase().includes(q) ||
        e.aliases.some(a => a.toLowerCase().includes(q)) ||
        e.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold flex-1">{str.entity_screen_title}</h2>
        <span className="text-xs text-gray-400 mr-1">{filtered.length}</span>
        <Button size="sm" onClick={onAdd}>{str.char_add}</Button>
      </header>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
        <input
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
          placeholder={str.entity_search_ph}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded px-2 py-1 text-xs bg-white"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as EntityType | "all")}
        >
          <option value="all">{str.entity_type_all}</option>
          {NON_CHAR_TYPES.map(t => (
            <option key={t} value={t}>{typeLabel(t)}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-12 px-4 space-y-2">
            <p>{str.entity_empty}</p>
            <p className="text-xs">{str.entity_empty_desc}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map(e => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{e.canonical_name}</p>
                    <span className={`text-xs rounded px-1.5 py-0.5 ${typeColor(e.type)}`}>
                      {typeLabel(e.type)}
                    </span>
                    {e.first_appearance != null && (
                      <span className="text-xs text-gray-400">{str.char_first_appear(e.first_appearance)}</span>
                    )}
                  </div>
                  {e.aliases.length > 0 && (
                    <p className="text-xs text-gray-400 truncate mt-0.5">{e.aliases.join(", ")}</p>
                  )}
                  {e.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{e.description}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" onClick={() => onEdit(e.id)}>{str.char_edit}</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(e.id)}>{str.char_delete}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

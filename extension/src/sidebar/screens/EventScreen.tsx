import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { db } from "@/lib/storage";
import type { Work, Event } from "@/lib/storage";
import { useStrings } from "@/lib/i18n";

interface Props {
  work: Work;
  onBack: () => void;
}

export function EventScreen({ work, onBack }: Props) {
  const str = useStrings();
  const [events, setEvents] = useState<Event[]>([]);
  const [entityMap, setEntityMap] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");

  const reload = async () => {
    const [evs, entities] = await Promise.all([
      db.events.where("work_id").equals(work.id).toArray(),
      db.entities.where("work_id").equals(work.id).toArray(),
    ]);
    setEvents(evs.sort((a, b) => a.first_chapter - b.first_chapter));
    setEntityMap(new Map(entities.map(e => [e.id, e.canonical_name])));
  };

  useEffect(() => { reload(); }, [work.id]);

  const handleDelete = async (id: string) => {
    if (!confirm(str.entity_delete_confirm)) return;
    await db.events.delete(id);
    reload();
  };

  const participantNames = (ev: Event): string => {
    const names = ev.who
      .map(p => entityMap.get(p.entity_id) ?? p.entity_id.slice(0, 8))
      .slice(0, 5);
    const extra = ev.who.length - names.length;
    return names.join("、") + (extra > 0 ? ` +${extra}` : "");
  };

  const filtered = events.filter(ev => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      ev.what.toLowerCase().includes(q) ||
      (ev.where ?? "").toLowerCase().includes(q) ||
      (ev.why ?? "").toLowerCase().includes(q) ||
      ev.content_tags.some(t => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>←</Button>
        <h2 className="text-sm font-semibold flex-1">{str.event_screen_title}</h2>
        <span className="text-xs text-gray-400">{filtered.length}</span>
      </header>

      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 shrink-0">
        <input
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
          placeholder={str.entity_search_ph}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-12 px-4 space-y-2">
            <p>{str.event_empty}</p>
            <p className="text-xs">{str.event_empty_desc}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map(ev => (
              <li key={ev.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                        {str.char_first_appear(ev.first_chapter)}
                      </span>
                      {ev.content_tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-xs bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm font-medium leading-snug">{ev.what}</p>
                    {ev.where && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="text-gray-400">{str.field_where}:</span> {ev.where}
                      </p>
                    )}
                    {ev.when && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="text-gray-400">{str.field_when}:</span> {ev.when}
                      </p>
                    )}
                    {ev.why && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="text-gray-400">{str.field_why}:</span> {ev.why}
                      </p>
                    )}
                    {ev.who.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="text-gray-400">{str.event_participants}:</span> {participantNames(ev)}
                      </p>
                    )}
                    {ev.occurrences.length > 1 && (
                      <p className="text-xs text-gray-400 mt-0.5">{str.event_in_chapters(ev.occurrences.length)}</p>
                    )}
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(ev.id)} className="shrink-0 mt-0.5">
                    {str.char_delete}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

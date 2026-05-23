import { useState, useEffect } from "react";
import { Button } from "../components/Button";
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

export function HomeScreen({ onSelectWork, onIngest, onSettings, onWorkRegister, onGuide }: Props) {
  const str = useStrings();
  const [works, setWorks] = useState<Work[]>([]);

  useEffect(() => { listWorks().then(setWorks); }, []);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <h1 className="text-sm font-semibold">{str.home_title}</h1>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onIngest}>{str.home_ingest_btn}</Button>
          <Button variant="ghost" size="sm" onClick={onWorkRegister}>{str.author_verify_btn}</Button>
          <Button variant="ghost" size="sm" onClick={onGuide}>{str.home_guide_btn}</Button>
          <Button variant="ghost" size="sm" onClick={onSettings}>{str.home_settings_btn}</Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {works.length === 0 ? (
          <div className="text-center text-sm text-gray-400 mt-16 px-4 space-y-3">
            <p>{str.home_empty}</p>
            <Button onClick={onIngest}>{str.home_cta}</Button>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {works.map(w => (
              <li key={w.id}>
                <button
                  onClick={() => onSelectWork(w)}
                  className="w-full text-left px-4 py-4 hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg shrink-0">
                    {w.title.slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{w.title}</p>
                    <p className="text-xs text-gray-400 truncate">{w.author}</p>
                  </div>
                  <span className="ml-auto text-gray-300 shrink-0">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

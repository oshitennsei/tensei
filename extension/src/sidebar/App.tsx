import { useState, useEffect, useCallback } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { WorkScreen } from "./screens/WorkScreen";
import { NewChatScreen } from "./screens/NewChatScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { CharacterScreen } from "./screens/CharacterScreen";
import { CharacterEditScreen } from "./screens/CharacterEditScreen";
import { EntityScreen } from "./screens/EntityScreen";
import { EntityEditScreen } from "./screens/EntityEditScreen";
import { EventScreen } from "./screens/EventScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { PersonaScreen } from "./screens/PersonaScreen";
import { IngestScreen } from "./screens/IngestScreen";
import { DebugScreen } from "./screens/DebugScreen";
import { PerformanceSetupScreen } from "./screens/PerformanceSetupScreen";
import { PerformanceScreen } from "./screens/PerformanceScreen";
import { SceneBriefScreen } from "./screens/SceneBriefScreen";
import { ProductionPlanScreen } from "./screens/ProductionPlanScreen";
import { BtsScreen } from "./screens/BtsScreen";
import { BtsBriefScreen } from "./screens/BtsBriefScreen";
import { WorkRegisterScreen } from "./screens/WorkRegisterScreen";
import { BackgroundProvider, useBackground } from "./context/BackgroundContext";
import { db } from "@/lib/storage";
import { saveModel, setRoleAssignment } from "@/lib/llm";
import { useStrings, useLang, type UILanguage } from "@/lib/i18n";
import { CHANGELOG } from "@/lib/changelog";
import type { BtsSetup } from "@/lib/bts";
import type { Work, Session, PerformanceSession, ProductionPlan, BtsSession, BtsLocation, BtsCrewMember } from "@/lib/storage";

const GUIDE_URL = "https://tensei-portal.pages.dev/guide";

function openGuide() {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({ url: GUIDE_URL });
  } else {
    window.open(GUIDE_URL, "_blank");
  }
}

function saveCurrentVersion() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ tensei_version: __APP_VERSION__ });
  }
}

function WelcomeDialog({ onViewNow, onLater }: { onViewNow: () => void; onLater: () => void }) {
  const str = useStrings();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">{str.welcome_title}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">{str.welcome_body}</p>
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onLater}
            className="px-4 py-2 rounded text-sm text-gray-500 hover:bg-gray-100 transition-colors"
          >
            {str.welcome_later}
          </button>
          <button
            onClick={onViewNow}
            className="px-4 py-2 rounded text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {str.welcome_view_now}
          </button>
        </div>
      </div>
    </div>
  );
}

function WhatsNewDialog({ lang, onClose }: { lang: UILanguage; onClose: () => void }) {
  const str = useStrings();
  const entry = CHANGELOG.find(e => e.version === __APP_VERSION__);
  const items = entry ? (entry.changes[lang as keyof typeof entry.changes] ?? entry.changes["en"]) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">{str.whats_new_title(__APP_VERSION__)}</h2>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="text-indigo-500 mt-0.5 shrink-0">✦</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {str.whats_new_close}
          </button>
        </div>
      </div>
    </div>
  );
}

type Screen =
  | { name: "home" }
  | { name: "work"; work: Work }
  | { name: "new-chat"; work: Work }
  | { name: "chat"; work: Work; session: Session }
  | { name: "characters"; work: Work }
  | { name: "character-edit"; work: Work; character_id: string | null }
  | { name: "entities"; work: Work }
  | { name: "entity-edit"; work: Work; entity_id: string | null }
  | { name: "events"; work: Work }
  | { name: "settings" }
  | { name: "persona" }
  | { name: "ingest" }
  | { name: "debug" }
  | { name: "performance-setup"; work: Work }
  | { name: "scene-brief"; work: Work; session: PerformanceSession }
  | { name: "production-plan"; work: Work; session: PerformanceSession; plan: ProductionPlan }
  | { name: "performance"; work: Work; session: PerformanceSession }
  | { name: "bts-brief"; work: Work; performanceSession: PerformanceSession }
  | { name: "bts"; work: Work; performanceSession: PerformanceSession; initialSession?: BtsSession; initialLocation?: BtsLocation; initialCrew?: BtsCrewMember[] }
  | { name: "work-register"; initialWorkUrl?: string };

function getWorkId(s: Screen): string | undefined {
  switch (s.name) {
    case "work":
    case "new-chat":
    case "chat":
    case "characters":
    case "character-edit":
    case "entities":
    case "entity-edit":
    case "events":
    case "performance-setup":
    case "scene-brief":
    case "production-plan":
    case "performance":
    case "bts-brief":
    case "bts":
      return s.work.id;
    default:
      return undefined;
  }
}

function ExpandButton() {
  const [isSidePanel, setIsSidePanel] = useState(window.innerWidth <= 480);
  useEffect(() => {
    const onResize = () => setIsSidePanel(window.innerWidth <= 480);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (!isSidePanel) return null;
  if (typeof chrome === 'undefined' || !chrome.windows) return null;
  const open = () => chrome.windows.create({
    url: chrome.runtime.getURL("src/sidebar/index.html"),
    type: "popup",
    width: 800,
    height: 900,
  });
  return (
    <button
      onClick={open}
      title="ウィンドウで開く"
      className="absolute top-2 right-2 z-20 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded text-sm transition-colors"
    >
      ↗
    </button>
  );
}

function AppContent() {
  const { bgCss, loadBackground } = useBackground();
  const lang = useLang();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [showWelcome, setShowWelcome] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  const dismissWelcome = useCallback((andOpen?: boolean) => {
    setShowWelcome(false);
    saveCurrentVersion();
    if (andOpen) openGuide();
  }, []);

  const dismissWhatsNew = useCallback(() => {
    setShowWhatsNew(false);
    saveCurrentVersion();
  }, []);

  const workId = getWorkId(screen);
  useEffect(() => { loadBackground(workId); }, [workId]);

  useEffect(() => {
    const goto = new URLSearchParams(window.location.search).get("goto");
    if (goto === "settings") {
      setScreen({ name: "settings" });
      window.history.replaceState({}, "", "/");
      return;
    }
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(["pending_model", "tensei_version"], async (result) => {
      // Model saved from portal guide (externally_connectable path)
      const m = result["pending_model"];
      if (m) {
        chrome.storage.local.remove("pending_model");
        await db.open();
        const id = await saveModel(m);
        for (const role of ["main", "sub_agent", "compression", "plan", "scene"] as const) {
          await setRoleAssignment(role, id);
        }
        setScreen({ name: "settings" });
        saveCurrentVersion();
        return;
      }
      const stored = result["tensei_version"] as string | undefined;
      if (!stored) {
        // First install
        setShowWelcome(true);
      } else if (stored !== __APP_VERSION__) {
        // Version updated — show What's New only if changelog entry exists
        const hasEntry = CHANGELOG.some(e => e.version === __APP_VERSION__);
        if (hasEntry) setShowWhatsNew(true);
        else saveCurrentVersion();
      }
    });
  }, []);

  const content = (() => {
    if (screen.name === "work") {
      return (
        <WorkScreen
          work={screen.work}
          onBack={() => setScreen({ name: "home" })}
          onSelectSession={session => setScreen({ name: "chat", work: screen.work, session })}
          onNewChat={() => setScreen({ name: "new-chat", work: screen.work })}
          onManageCharacters={() => setScreen({ name: "characters", work: screen.work })}
          onManageEntities={() => setScreen({ name: "entities", work: screen.work })}
          onManageEvents={() => setScreen({ name: "events", work: screen.work })}
          onWorkDeleted={() => setScreen({ name: "home" })}
          onPerformance={() => setScreen({ name: "performance-setup", work: screen.work })}
          onResumePerformance={session => setScreen({ name: "performance", work: screen.work, session })}
        />
      );
    }
    if (screen.name === "performance-setup") {
      return (
        <PerformanceSetupScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onStart={session => setScreen({ name: "scene-brief", work: screen.work, session })}
          onManageCharacters={() => setScreen({ name: "characters", work: screen.work })}
        />
      );
    }
    if (screen.name === "scene-brief") {
      return (
        <SceneBriefScreen
          work={screen.work}
          session={screen.session}
          onBack={() => setScreen({ name: "performance-setup", work: screen.work })}
          onPlanReady={(plan, updatedSession) =>
            setScreen({ name: "production-plan", work: screen.work, session: updatedSession, plan })
          }
        />
      );
    }
    if (screen.name === "production-plan") {
      return (
        <ProductionPlanScreen
          work={screen.work}
          session={screen.session}
          plan={screen.plan}
          onBack={() => setScreen({ name: "scene-brief", work: screen.work, session: screen.session })}
          onStart={_plan => setScreen({ name: "performance", work: screen.work, session: screen.session })}
        />
      );
    }
    if (screen.name === "performance") {
      return (
        <PerformanceScreen
          work={screen.work}
          session={screen.session}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onGoBackstage={session => setScreen({ name: "bts-brief", work: screen.work, performanceSession: session })}
        />
      );
    }
    if (screen.name === "bts-brief") {
      return (
        <BtsBriefScreen
          work={screen.work}
          performanceSession={screen.performanceSession}
          onBack={() => setScreen({ name: "performance", work: screen.work, session: screen.performanceSession })}
          onReady={(setup: BtsSetup, session: BtsSession) =>
            setScreen({
              name: "bts",
              work: screen.work,
              performanceSession: screen.performanceSession,
              initialSession: session,
              initialLocation: setup.location,
              initialCrew: setup.crew,
            })
          }
        />
      );
    }
    if (screen.name === "bts") {
      return (
        <BtsScreen
          work={screen.work}
          performanceSession={screen.performanceSession}
          onBack={() => setScreen({ name: "bts-brief", work: screen.work, performanceSession: screen.performanceSession })}
          initialSession={screen.initialSession}
          initialLocation={screen.initialLocation}
          initialCrew={screen.initialCrew}
        />
      );
    }
    if (screen.name === "new-chat") {
      return (
        <NewChatScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onStart={session => setScreen({ name: "chat", work: screen.work, session })}
        />
      );
    }
    if (screen.name === "chat") {
      return (
        <ChatScreen
          work={screen.work}
          session={screen.session}
          onBack={() => setScreen({ name: "work", work: screen.work })}
        />
      );
    }
    if (screen.name === "characters") {
      return (
        <CharacterScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onEdit={character_id => setScreen({ name: "character-edit", work: screen.work, character_id })}
          onAdd={() => setScreen({ name: "character-edit", work: screen.work, character_id: null })}
        />
      );
    }
    if (screen.name === "character-edit") {
      return (
        <CharacterEditScreen
          work={screen.work}
          character_id={screen.character_id}
          onBack={() => setScreen({ name: "characters", work: screen.work })}
          onSaved={() => setScreen({ name: "characters", work: screen.work })}
        />
      );
    }
    if (screen.name === "entities") {
      return (
        <EntityScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onEdit={entity_id => setScreen({ name: "entity-edit", work: screen.work, entity_id })}
          onAdd={() => setScreen({ name: "entity-edit", work: screen.work, entity_id: null })}
        />
      );
    }
    if (screen.name === "entity-edit") {
      return (
        <EntityEditScreen
          work={screen.work}
          entity_id={screen.entity_id}
          onBack={() => setScreen({ name: "entities", work: screen.work })}
          onSaved={() => setScreen({ name: "entities", work: screen.work })}
        />
      );
    }
    if (screen.name === "events") {
      return (
        <EventScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
        />
      );
    }
    if (screen.name === "settings") {
      return (
        <SettingsScreen
          onBack={() => setScreen({ name: "home" })}
          onDebug={() => setScreen({ name: "debug" })}
          onPersona={() => setScreen({ name: "persona" })}
        />
      );
    }
    if (screen.name === "persona") {
      return <PersonaScreen onBack={() => setScreen({ name: "settings" })} />;
    }
    if (screen.name === "ingest") {
      return (
        <IngestScreen
          onBack={() => setScreen({ name: "home" })}
          onDone={(_work, _ch) => setScreen({ name: "home" })}
          onWorkRegister={(workUrl) => setScreen({ name: "work-register", initialWorkUrl: workUrl })}
        />
      );
    }
    if (screen.name === "debug") {
      return <DebugScreen onBack={() => setScreen({ name: "settings" })} />;
    }
    if (screen.name === "work-register") {
      return <WorkRegisterScreen onBack={() => setScreen({ name: "home" })} initialWorkUrl={screen.initialWorkUrl} />;
    }
    return (
      <HomeScreen
        onSelectWork={work => setScreen({ name: "work", work })}
        onIngest={() => setScreen({ name: "ingest" })}
        onSettings={() => setScreen({ name: "settings" })}
        onWorkRegister={() => setScreen({ name: "work-register" })}
        onGuide={openGuide}
      />
    );
  })();

  return (
    <div className="relative h-full overflow-hidden">
      <div className="fixed inset-0 z-0" style={{ background: bgCss }} />
      <div className="relative z-10 h-full bg-white/80 backdrop-blur-sm">
        {content}
      </div>
      <ExpandButton />
      {showWelcome && (
        <WelcomeDialog
          onViewNow={() => dismissWelcome(true)}
          onLater={() => dismissWelcome(false)}
        />
      )}
      {showWhatsNew && (
        <WhatsNewDialog lang={lang} onClose={dismissWhatsNew} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <BackgroundProvider>
      <AppContent />
    </BackgroundProvider>
  );
}

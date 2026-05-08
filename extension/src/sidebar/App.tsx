import { useState, useEffect } from "react";
import { HomeScreen } from "./screens/HomeScreen";
import { WorkScreen } from "./screens/WorkScreen";
import { NewChatScreen } from "./screens/NewChatScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { CharacterScreen } from "./screens/CharacterScreen";
import { CharacterEditScreen } from "./screens/CharacterEditScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { PersonaScreen } from "./screens/PersonaScreen";
import { IngestScreen } from "./screens/IngestScreen";
import { DebugScreen } from "./screens/DebugScreen";
import { PerformanceSetupScreen } from "./screens/PerformanceSetupScreen";
import { PerformanceScreen } from "./screens/PerformanceScreen";
import { BtsScreen } from "./screens/BtsScreen";
import { BackgroundProvider, useBackground } from "./context/BackgroundContext";
import type { Work, Session, PerformanceSession } from "@/lib/storage";

type Screen =
  | { name: "home" }
  | { name: "work"; work: Work }
  | { name: "new-chat"; work: Work }
  | { name: "chat"; work: Work; session: Session }
  | { name: "characters"; work: Work }
  | { name: "character-edit"; work: Work; character_id: string | null }
  | { name: "settings" }
  | { name: "persona" }
  | { name: "ingest" }
  | { name: "debug" }
  | { name: "performance-setup"; work: Work }
  | { name: "performance"; work: Work; session: PerformanceSession }
  | { name: "bts"; work: Work; performanceSession: PerformanceSession };

function getWorkId(s: Screen): string | undefined {
  switch (s.name) {
    case "work":
    case "new-chat":
    case "chat":
    case "characters":
    case "character-edit":
    case "performance-setup":
    case "performance":
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
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  const workId = getWorkId(screen);
  useEffect(() => { loadBackground(workId); }, [workId]);

  const content = (() => {
    if (screen.name === "work") {
      return (
        <WorkScreen
          work={screen.work}
          onBack={() => setScreen({ name: "home" })}
          onSelectSession={session => setScreen({ name: "chat", work: screen.work, session })}
          onNewChat={() => setScreen({ name: "new-chat", work: screen.work })}
          onManageCharacters={() => setScreen({ name: "characters", work: screen.work })}
          onWorkDeleted={() => setScreen({ name: "home" })}
          onPerformance={() => setScreen({ name: "performance-setup", work: screen.work })}
        />
      );
    }
    if (screen.name === "performance-setup") {
      return (
        <PerformanceSetupScreen
          work={screen.work}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onStart={session => setScreen({ name: "performance", work: screen.work, session })}
          onManageCharacters={() => setScreen({ name: "characters", work: screen.work })}
        />
      );
    }
    if (screen.name === "performance") {
      return (
        <PerformanceScreen
          work={screen.work}
          session={screen.session}
          onBack={() => setScreen({ name: "work", work: screen.work })}
          onGoBackstage={session => setScreen({ name: "bts", work: screen.work, performanceSession: session })}
        />
      );
    }
    if (screen.name === "bts") {
      return (
        <BtsScreen
          work={screen.work}
          performanceSession={screen.performanceSession}
          onBack={() => setScreen({ name: "performance", work: screen.work, session: screen.performanceSession })}
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
        />
      );
    }
    if (screen.name === "debug") {
      return <DebugScreen onBack={() => setScreen({ name: "settings" })} />;
    }
    return (
      <HomeScreen
        onSelectWork={work => setScreen({ name: "work", work })}
        onIngest={() => setScreen({ name: "ingest" })}
        onSettings={() => setScreen({ name: "settings" })}
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

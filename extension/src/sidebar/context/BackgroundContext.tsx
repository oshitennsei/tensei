import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { getEffectiveBackground, DEFAULT_BG } from "@/lib/background";

interface BackgroundContextValue {
  bgCss: string;
  loadBackground: (workId?: string) => Promise<void>;
}

const BackgroundContext = createContext<BackgroundContextValue>({
  bgCss: DEFAULT_BG,
  loadBackground: async () => {},
});

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [bgCss, setBgCss] = useState<string>(DEFAULT_BG);

  const loadBackground = useCallback(async (workId?: string) => {
    const css = await getEffectiveBackground(workId);
    setBgCss(css);
  }, []);

  return (
    <BackgroundContext.Provider value={{ bgCss, loadBackground }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export const useBackground = () => useContext(BackgroundContext);

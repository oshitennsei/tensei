import "fake-indexeddb/auto";

// Stub out assets that Vite would normally handle
vi.mock("@/assets/default-bg.png", () => ({ default: "data:image/png;base64,stub" }));

// crypto.randomUUID is available in jsdom but ensure it exists
if (typeof crypto === "undefined" || !crypto.randomUUID) {
  Object.defineProperty(global, "crypto", {
    value: {
      randomUUID: () => `${Math.random().toString(36).slice(2)}-${Date.now()}`,
    },
  });
}

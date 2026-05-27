import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { db } from "@/lib/storage";
import App from "./App";
import { GuidePage } from "@/guide";

const isGuide = window.location.pathname === "/guide" || window.location.pathname.startsWith("/guide/");

if (!isGuide) db.open().catch(console.error);

// Request persistent storage so the browser doesn't evict WASM / model caches under pressure
if ("storage" in navigator && "persist" in navigator.storage) {
  navigator.storage.persist();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isGuide ? <GuidePage /> : <App />}
  </React.StrictMode>
);

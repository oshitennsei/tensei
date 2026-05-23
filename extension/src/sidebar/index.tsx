import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { db } from "@/lib/storage";
import App from "./App";
import { GuidePage } from "@/guide";

const isGuide = window.location.pathname === "/guide" || window.location.pathname.startsWith("/guide/");

if (!isGuide) db.open().catch(console.error);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isGuide ? <GuidePage /> : <App />}
  </React.StrictMode>
);

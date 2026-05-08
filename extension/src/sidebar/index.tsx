import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { db } from "@/lib/storage";
import App from "./App";

db.open().catch(console.error);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

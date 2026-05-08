import { Routes, Route } from "react-router-dom";
import { RegisterPage } from "./pages/Register";
import { DashboardPage } from "./pages/Dashboard";
import { AdminPage } from "./pages/Admin";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <span className="text-lg font-semibold text-indigo-400">転生 著者ポータル</span>
        <span className="text-xs text-gray-500 ml-auto">
          <a href="https://github.com/Chakotay-Lee/tensei" className="hover:text-indigo-400" target="_blank" rel="noopener noreferrer">GitHub</a>
        </span>
      </nav>
      <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </div>
  );
}

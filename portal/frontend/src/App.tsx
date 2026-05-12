import { Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { RegisterPage } from "./pages/Register";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { AdminPage } from "./pages/Admin";

// Handles ?token= redirect from magic link verify
function TokenCatcher() {
  const [params] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get("token");
    if (!token) return;
    login(token).then(() => {
      navigate("/dashboard", { replace: true });
    });
  }, []);

  return null;
}

function Nav() {
  const { author, logout } = useAuth();
  return (
    <nav className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
      <a href="/" className="text-lg font-semibold text-indigo-400 hover:text-indigo-300">転生 著者ポータル</a>
      <span className="flex-1" />
      {author ? (
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">{author.display_name}</span>
          <button onClick={logout} className="text-xs text-gray-500 hover:text-gray-300">ログアウト</button>
        </div>
      ) : (
        <a href="/login" className="text-sm text-indigo-400 hover:text-indigo-300">ログイン</a>
      )}
      <a href="https://github.com/Chakotay-Lee/tensei" className="text-xs text-gray-500 hover:text-indigo-400" target="_blank" rel="noopener noreferrer">GitHub</a>
    </nav>
  );
}

function AppInner() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Nav />
      <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<><TokenCatcher /><DashboardPage /></>} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

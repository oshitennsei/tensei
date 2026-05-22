import { Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { HomePage } from "./pages/Home";
import { RegisterPage } from "./pages/Register";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { AdminPage } from "./pages/Admin";
import { GuidePage } from "./pages/Guide";

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
      <a href="/" className="text-lg font-semibold text-indigo-400 hover:text-indigo-300">転生</a>
      <a href="/guide" className="text-sm text-yellow-400 hover:text-yellow-300">転生学校 🎓</a>
      <a href="/app" className="text-sm text-gray-400 hover:text-gray-200">アプリ</a>
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

function Footer() {
  return (
    <footer className="border-t border-gray-800 px-6 py-6 mt-auto">
      <p className="text-xs text-gray-600 leading-relaxed text-center max-w-2xl mx-auto">
        本サービスは小説家になろう・カクヨム（株式会社KADOKAWA）等の各プラットフォームの公式サービスとは一切関係ありません。
        小説の著作権は各著作者に帰属します。AIが生成するキャラクターの発言は原著の内容を保証するものではありません。
        各プラットフォームの利用規約を遵守した個人利用の範囲内でご利用ください。<br />
        © 2026 Tensei ·{" "}
        <a
          href="https://oshitennsei.github.io/tensei/privacy-policy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-400 underline"
        >
          プライバシーポリシー
        </a>
      </p>
    </footer>
  );
}

function AppInner() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Nav />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<><TokenCatcher /><DashboardPage /></>} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </div>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/guide" element={<GuidePage />} />
      <Route path="/*" element={
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      } />
    </Routes>
  );
}

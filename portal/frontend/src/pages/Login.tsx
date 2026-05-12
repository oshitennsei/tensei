import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";

export function LoginPage() {
  const { author } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"form" | "sent">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (author) {
    navigate("/dashboard", { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.login(email);
      setStep("sent");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  if (step === "sent") {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="text-5xl mb-6">📬</div>
        <h1 className="text-2xl font-bold mb-3">ログインリンクを送信しました</h1>
        <p className="text-gray-400 mb-4">
          <strong>{email}</strong> 宛にマジックリンクを送りました。<br />
          メールを開いてリンクをクリックしてください（10分間有効）。
        </p>
        <button className="text-indigo-400 hover:underline text-sm" onClick={() => setStep("form")}>
          別のアドレスで試す
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">ログイン</h1>
      <p className="text-gray-400 mb-8 text-sm">
        登録済みのメールアドレスにログインリンクを送信します。
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1.5">メールアドレス</label>
          <input
            type="email"
            required
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          {loading ? "送信中..." : "ログインリンクを送信"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        アカウントをお持ちでない方は{" "}
        <a href="/" className="text-indigo-400 hover:underline">こちらから登録</a>
      </p>
    </main>
  );
}

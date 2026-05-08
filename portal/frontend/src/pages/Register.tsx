import { useState } from "react";
import { api } from "../api";

type Step = "form" | "sent";

export function RegisterPage() {
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.register(email, name);
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
        <h1 className="text-2xl font-bold mb-3">確認メールを送信しました</h1>
        <p className="text-gray-400 mb-6">
          <strong>{email}</strong> 宛にマジックリンクを送りました。<br />
          メールを開いてリンクをクリックしてください（10分間有効）。
        </p>
        <p className="text-sm text-gray-500">
          メールが届かない場合はスパムフォルダをご確認ください。
        </p>
        <button
          className="mt-6 text-indigo-400 hover:underline text-sm"
          onClick={() => setStep("form")}
        >
          別のアドレスで登録する
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">著者登録</h1>
      <p className="text-gray-400 mb-8 text-sm leading-relaxed">
        Tenseiに公式キャラクター設定を提供するには、著者認証が必要です。
        小説家になろう・Kakuyomuで作品を公開している著者のみご利用いただけます。
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1.5">表示名</label>
          <input
            type="text"
            required
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="ペンネームまたは本名"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
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

        {error && (
          <p className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          {loading ? "送信中..." : "確認メールを送信"}
        </button>
      </form>

      <div className="mt-10 border-t border-gray-800 pt-8">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">登録の流れ</h2>
        <ol className="space-y-3 text-sm text-gray-400">
          <li className="flex gap-3">
            <span className="text-indigo-400 font-mono font-bold shrink-0">1.</span>
            <span>メールアドレスを確認（マジックリンク）</span>
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400 font-mono font-bold shrink-0">2.</span>
            <span>作品情報を入力し、確認コードを「作者ノート」に投稿</span>
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400 font-mono font-bold shrink-0">3.</span>
            <span>管理者が確認・承認（通常数日以内）</span>
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400 font-mono font-bold shrink-0">4.</span>
            <span>キャラクター設定を提出 → GitHub PRが自動作成</span>
          </li>
        </ol>
      </div>
    </main>
  );
}

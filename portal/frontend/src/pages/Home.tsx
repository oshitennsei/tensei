const WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/キャラクターが転生してきた件/fmbhoboogphkfenpekeklmkkjhbcfmmc";

export function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-12">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold text-white">キャラクターが転生してきた件</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          なろう・カクヨムの登場人物と、AIでリアルタイムに会話できるアプリ
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-5">
          <div>
            <p className="text-xs text-indigo-400 font-medium uppercase tracking-wider mb-1">読者・利用者の方</p>
            <h2 className="text-lg font-semibold text-white">まずは転生学校へ</h2>
            <p className="text-sm text-gray-400 mt-1">
              インストール方法・APIキーの設定・使い方をステップで解説します
            </p>
          </div>
          <div className="space-y-2.5">
            <a
              href="/guide"
              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              転生学校で始める 🎓
            </a>
            <a
              href="/app"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              ブラウザ版を使う（PWA）
            </a>
            <a
              href={WEB_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              Chrome拡張機能をインストール
            </a>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-5">
          <div>
            <p className="text-xs text-yellow-500 font-medium uppercase tracking-wider mb-1">著者の方</p>
            <h2 className="text-lg font-semibold text-white">著者ポータル</h2>
            <p className="text-sm text-gray-400 mt-1">
              作品を登録して、キャラクター設定を読者向けに公開できます
            </p>
          </div>
          <div className="space-y-2.5">
            <a
              href="/register"
              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              作品を登録する
            </a>
            <a
              href="/login"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              著者ログイン
            </a>
          </div>
        </div>
      </div>

      <div className="border border-gray-800 rounded-xl p-6 grid grid-cols-3 gap-4 text-center">
        <div className="space-y-1.5">
          <p className="text-2xl">💬</p>
          <p className="text-sm font-medium text-gray-200">自由な会話</p>
          <p className="text-xs text-gray-500">キャラの個性を再現したAIと対話</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-2xl">📚</p>
          <p className="text-sm font-medium text-gray-200">多作品対応</p>
          <p className="text-xs text-gray-500">なろう・カクヨムに対応</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-2xl">🔒</p>
          <p className="text-sm font-medium text-gray-200">データはローカル</p>
          <p className="text-xs text-gray-500">会話履歴はデバイスに保存</p>
        </div>
      </div>
    </div>
  );
}

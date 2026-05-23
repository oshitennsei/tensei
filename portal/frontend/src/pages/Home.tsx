const WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/キャラクターが転生してきた件/fmbhoboogphkfenpekeklmkkjhbcfmmc";

const JA = {
  tagline: "物語の宇宙に、踏み込む",
  concept1: "これは「キャラクターと話すアプリ」ではありません。",
  concept2: "一つひとつの小説が宇宙です。あなたはその宇宙に踏み込む探索者です。",

  reader_badge: "読者・利用者の方",
  reader_title: "まずは転生学校へ",
  reader_desc: "インストール方法・APIキーの設定・使い方をステップで解説します",
  btn_guide: "転生学校で始める 🎓",
  btn_pwa: "ブラウザ版を使う（PWA）",
  btn_chrome: "Chrome拡張機能をインストール",

  author_badge: "著者の方",
  author_title: "著者ポータル",
  author_desc: "作品を登録して、キャラクター設定を読者向けに公開できます",
  btn_register: "作品を登録する",
  btn_login: "著者ログイン",

  feat1_icon: "📖",
  feat1_title: "世界は選んだ章に止まる",
  feat1_body: "キャラは指定した章より先を知らない。ネタバレなし、その瞬間に生きられる。",

  feat2_icon: "🕰",
  feat2_title: "同じ魂、違う時間",
  feat2_body: "若き日と老年の同じキャラが、それぞれの時代の自分として存在する。",

  feat3_icon: "🌍",
  feat3_title: "一つの宇宙として息づく",
  feat3_body: "同作品のキャラはお互いを正しく認識。関係・過去・文脈が全て整合する。",
};

const ZH_TW = {
  tagline: "踏入故事的宇宙",
  concept1: "這不只是「和角色聊天的工具」。",
  concept2: "每一部小說都是一個宇宙，而你是踏入其中的探索者。",

  reader_badge: "讀者・使用者",
  reader_title: "從轉生學校開始",
  reader_desc: "逐步說明安裝方式、API 金鑰設定與使用方法",
  btn_guide: "前往轉生學校 🎓",
  btn_pwa: "使用瀏覽器版（PWA）",
  btn_chrome: "安裝 Chrome 擴充功能",

  author_badge: "作者",
  author_title: "作者入口",
  author_desc: "登錄作品，並向讀者公開角色設定",
  btn_register: "登錄作品",
  btn_login: "作者登入",

  feat1_icon: "📖",
  feat1_title: "世界停在你選擇的章節",
  feat1_body: "角色不知道那章以後的事。沒有劇透，你活在那個當下。",

  feat2_icon: "🕰",
  feat2_title: "相同的靈魂，不同的時代",
  feat2_body: "年輕時的角色與年老後的同一人，各自活在屬於自己的時代。",

  feat3_icon: "🌍",
  feat3_title: "作為一個宇宙而存在",
  feat3_body: "同作品的角色彼此認識，關係、過往、世界脈絡——一切都一致。",
};

const ZH_CN = {
  tagline: "踏入故事的宇宙",
  concept1: "这不只是「和角色聊天的工具」。",
  concept2: "每一部小说都是一个宇宙，而你是踏入其中的探索者。",

  reader_badge: "读者・使用者",
  reader_title: "从转生学校开始",
  reader_desc: "逐步说明安装方式、API 密钥设定与使用方法",
  btn_guide: "前往转生学校 🎓",
  btn_pwa: "使用浏览器版（PWA）",
  btn_chrome: "安装 Chrome 扩展",

  author_badge: "作者",
  author_title: "作者入口",
  author_desc: "登录作品，并向读者公开角色设定",
  btn_register: "登录作品",
  btn_login: "作者登录",

  feat1_icon: "📖",
  feat1_title: "世界停在你选择的章节",
  feat1_body: "角色不知道那章以后的事。没有剧透，你活在那个当下。",

  feat2_icon: "🕰",
  feat2_title: "相同的灵魂，不同的时代",
  feat2_body: "年轻时的角色与年老后的同一人，各自活在属于自己的时代。",

  feat3_icon: "🌍",
  feat3_title: "作为一个宇宙而存在",
  feat3_body: "同作品的角色彼此认识，关系、过往、世界脉络——一切都一致。",
};

const EN = {
  tagline: "Step into the universe of a story.",
  concept1: "This isn't just a character chat app.",
  concept2: "Every novel is a universe. You step inside as an explorer, not just a reader.",

  reader_badge: "Readers",
  reader_title: "Start at Tensei Academy",
  reader_desc: "Step-by-step guide for installation, API key setup, and getting started",
  btn_guide: "Go to Tensei Academy 🎓",
  btn_pwa: "Use the browser app (PWA)",
  btn_chrome: "Install Chrome Extension",

  author_badge: "Authors",
  author_title: "Author Portal",
  author_desc: "Register your work and publish character settings for readers",
  btn_register: "Register a work",
  btn_login: "Author login",

  feat1_icon: "📖",
  feat1_title: "The world stops at your chapter.",
  feat1_body: "Characters know nothing beyond the chapter you select. Live inside that moment — no spoilers.",

  feat2_icon: "🕰",
  feat2_title: "Same soul, different era.",
  feat2_body: "Meet the same character at different points in time — each shaped by their era.",

  feat3_icon: "🌍",
  feat3_title: "One universe, one truth.",
  feat3_body: "Characters from the same work know each other — relationships, history, and world logic all cohere.",
};

function useLang() {
  const l = navigator.language.toLowerCase();
  if (l.startsWith("zh-tw") || l.startsWith("zh-hant")) return ZH_TW;
  if (l.startsWith("zh")) return ZH_CN;
  if (l.startsWith("ja")) return JA;
  return EN;
}

export function HomePage() {
  const T = useLang();

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-12">
      {/* Hero */}
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold text-white">キャラクターが転生してきた件</h1>
        <p className="text-lg text-indigo-300 font-medium">{T.tagline}</p>
        <p className="text-sm text-gray-400 leading-relaxed max-w-md mx-auto">
          {T.concept1}<br />{T.concept2}
        </p>
      </div>

      {/* Reader / Author cards */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-5">
          <div>
            <p className="text-xs text-indigo-400 font-medium uppercase tracking-wider mb-1">{T.reader_badge}</p>
            <h2 className="text-lg font-semibold text-white">{T.reader_title}</h2>
            <p className="text-sm text-gray-400 mt-1">{T.reader_desc}</p>
          </div>
          <div className="space-y-2.5">
            <a
              href="/guide"
              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              {T.btn_guide}
            </a>
            <a
              href="/app"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              {T.btn_pwa}
            </a>
            <a
              href={WEB_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              {T.btn_chrome}
            </a>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-7 space-y-5">
          <div>
            <p className="text-xs text-yellow-500 font-medium uppercase tracking-wider mb-1">{T.author_badge}</p>
            <h2 className="text-lg font-semibold text-white">{T.author_title}</h2>
            <p className="text-sm text-gray-400 mt-1">{T.author_desc}</p>
          </div>
          <div className="space-y-2.5">
            <a
              href="/register"
              className="flex items-center justify-center w-full py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              {T.btn_register}
            </a>
            <a
              href="/login"
              className="flex items-center justify-center w-full py-2.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-300 text-sm transition-colors"
            >
              {T.btn_login}
            </a>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: T.feat1_icon, title: T.feat1_title, body: T.feat1_body },
          { icon: T.feat2_icon, title: T.feat2_title, body: T.feat2_body },
          { icon: T.feat3_icon, title: T.feat3_title, body: T.feat3_body },
        ].map((f) => (
          <div key={f.title} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
            <p className="text-2xl">{f.icon}</p>
            <p className="text-sm font-semibold text-gray-200 leading-snug">{f.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

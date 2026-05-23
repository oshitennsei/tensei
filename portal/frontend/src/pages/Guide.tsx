import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang = "ja" | "zh-TW" | "zh-CN" | "en";

// ─── i18n ────────────────────────────────────────────────────────────────────

const T = {
  ja: {
    langLabel: "言語",
    stages: ["異世界に転生", "旅立ち", "初めての街", "仲間との出会い", "冒険の本格化", "伝説の冒険者"],
    hero: {
      eyebrow: "転生者の旅程",
      title: "転生学校",
      sub: "キャラクターが転生してきた件 — 入学案内",
      cta: "旅を始める",
    },
    s0: {
      badge: "異世界に転生",
      mascot: "ようこそ、転生学校へ！あなたは今、新しい世界に転生したばかりです。まずはこの世界のルールを学びましょう。",
      cards: [
        { icon: "📖", title: "Tensei とは", body: "小説のキャラクターが「本当に存在する」かのように対話できるツールです。キャラクターの性格・口調・世界観を AI が再現します。" },
        { icon: "✅", title: "著者認証について", body: "Tensei は著者が認証した作品を使用します。作者の意図を尊重し、承認を得た範囲内でのみ動作します。" },
        { icon: "🔑", title: "APIキーが必要な理由", body: "AI と通信するための「通行証」です。キーはあなたのデバイスだけに保存され、私たちのサーバーには送られません。" },
        { icon: "🔓", title: "オープンソースの安心感", body: "Tensei のコードはすべて公開中です。「本当に鍵を盗まれないか」は GitHub でご自身で確認できます。" },
      ],
      cta: "最初のクエストへ →",
    },
    s1: {
      badge: "旅立ち",
      mascot: "最初のクエストへようこそ。魔法の鍵（APIキー）を手に入れましょう。無料で、クレジットカードも不要です！",
      goblin: "哥不林は見た目より弱い！",
      signupBtn: "申請ページへ →",
      keyFormat: "キーの形式:",
      keyPlaceholder: "取得した API Key をここに貼り付け...",
      testBtn: "テスト",
      testing: "テスト中...",
      testOk: "✅ 認証成功！",
      testFail: "❌ 認証失敗。キーを確認してください。",
      modelSuggestion: "おすすめモデル:",
      copyBtn: "キーをコピー",
      copied: "コピーしました！",
      copyHint: "コピーしたら、Tensei の設定画面で「＋ モデルを追加」して貼り付けてください。",
      multiKeyTip: "💡 複数のキーを設定しておくと、残量切れ時に切り替えられます。",
      noCorsHint: "⚠️ NIM はブラウザからの直接テストができません。キーを入力してそのまま保存できます。",
      urlLabel: "サーバー URL",
      localModelLabel: "モデル名",
      localHint: "⚠️ Ollama / LM Studio は同じデバイス上で起動している必要があります。",
      extFound: "🔌 拡張機能を検出 — 自動で拡張機能に保存します",
      extSaveBtn: "拡張機能に保存",
      extSaving: "拡張機能に保存中...",
      extSaved: "✅ 拡張機能に保存しました！設定画面が開きます。",
      pwaFound: "💾 ブラウザに保存します（拡張機能なし）",
      pwaSaveBtn: "ブラウザに保存",
      pwaSaving: "保存中...",
      pwaSaved: "✅ 保存しました！引き続き学習を進めましょう。",
      cities: [
        {
          dir: "東",
          name: "OpenRouter",
          sub: "商人の街 — 多くのルートを持つ初心者向けの街",
          badge: "✨ 初心者おすすめ",
          color: "#22c55e",
          steps: [
            "openrouter.ai を開く",
            "Sign up → Google または Email で登録",
            "Keys → Create Key → 名前を入力",
            "キーをコピー（sk-or-v1-... で始まる）",
          ],
        },
        {
          dir: "南",
          name: "Google AI Studio",
          sub: "学者の学府 — Google アカウントがあれば無料",
          badge: "🆓 完全無料",
          color: "#6366f1",
          steps: [
            "aistudio.google.com を開く",
            "Google アカウントでログイン",
            "「Get API key」→「Create API key」",
            "キーをコピー（AIza... で始まる）",
          ],
        },
        {
          dir: "北",
          name: "NVIDIA NIM",
          sub: "武人の要塞 — 強力だが上級者向け",
          badge: "⚔️ 上級者向け",
          color: "#d4af37",
          steps: [
            "build.nvidia.com を開く",
            "NVIDIA アカウントで登録",
            "Get API Key → Generate Key",
            "キーをコピー（nvapi-... で始まる）",
          ],
        },
        {
          dir: "西",
          name: "Ollama / LM Studio",
          sub: "地元の隠者 — ローカルで動作する上級者向け",
          badge: "🏠 ローカル実行",
          color: "#f97316",
          steps: [
            "Ollama または LM Studio をインストール",
            "モデルをダウンロード（例: llama3.2）",
            "サーバーを起動（通常 http://localhost:11434）",
            "以下で URL とモデル名を設定して保存",
          ],
        },
      ],
      complete: "🎉 APIキーを取得しました！次の街へ進もう。",
    },
    s2: {
      badge: "初めての街",
      mascot: "世界に入るには扉が必要です。あなたの旅のスタイルに合った扉を選びましょう。教材として《呪甲》を使います。",
      novelName: "呪甲",
      novelAuthor: "Alex Lee 著 — カクヨム",
      tabs: [
        {
          name: "Chrome 拡張機能版",
          icon: "🧩",
          steps: [
            "カクヨム で《呪甲》のページを開く",
            "ブラウザ右上の 転生アイコン をクリック",
            "サイドバーで「＋ 匯入」をクリック",
            "導入したいエピソードにチェック",
            "「導入開始」を押す",
          ],
        },
        {
          name: "Web 版（PWA）",
          icon: "🌐",
          steps: [
            "Tensei Web 版を開く",
            "「＋ 匯入」をクリック",
            "《呪甲》の URL を貼り付ける",
            "エピソードを選択",
            "「導入開始」を押す",
          ],
        },
      ],
      complete: "🌆 《呪甲》の世界に到着しました！",
    },
    s3: {
      badge: "仲間との出会い",
      mascot: "世界の住人があなたを待っています。話しかけてみましょう。",
      steps: ["作品カードをクリック", "キャラクターを選ぶ", "メッセージを入力して送信"],
      demoUser: "あなた",
      demoChar: "（《呪甲》のキャラクター）",
      demoQ: "こんにちは。あなたは何者ですか？",
      demoA: "……この呪甲が、見知らぬ者に語りかけられるとは。貴様、よほど度胸があるか、それとも世界の理を知らぬのか。",
      tips: [
        "💡 コンテキストを多めに設定すると、より深い返答が得られます",
        "💡 キャラクター設定画面で性格を微調整できます",
        "💡 自然な言葉で話しかけると、キャラクターも自然に応えます",
      ],
      complete: "🤝 世界の住人と繋がりができました！",
    },
    s4: {
      badge: "冒険の本格化",
      mascot: "上級者の証。複数のキャラクターを同時に動かして、あなただけの物語を演じましょう。",
      cards: [
        { icon: "🎭", title: "キャストを設定する", body: "複数のキャラクターを選んでキャストに追加します。それぞれの役割を設定できます。" },
        { icon: "🎬", title: "シーンを指定する", body: "どの場面で、どんな状況かを設定します。キャラクターたちが世界の論理に従って動きます。" },
        { icon: "✏️", title: "物語に参加する", body: "読者として観察するか、自分もキャラクターとして参加するか選べます。" },
      ],
      complete: "🌟 演出モードへ入場しました！",
    },
    s5: {
      badge: "伝説の冒険者",
      mascot: "あなたの旅は最終章へ。しかし、これは終わりではなく、新しい始まりです。",
      steps: [
        { icon: "📝", title: "自分の物語を書く", body: "読者として楽しんでいたあなたが、今度は自分の世界を創る番です。" },
        { icon: "🌟", title: "著者として登録する", body: "カクヨム・なろうで執筆中なら、著者ポータルに申請できます。" },
        { icon: "🌍", title: "世界を Tensei に提供する", body: "あなたの作品のキャラクターを、読者が対話できるようになります。" },
      ],
      cta: "著者ポータルへ →",
      ctaUrl: "/register",
      epilogue: "Tensei の世界は、あなたが加わることで広がります。",
    },
    footer: {
      install: "拡張機能をインストール",
      pwa: "Web 版を開く",
      portal: "著者ポータルへ",
      github: "GitHub",
    },
  },
  "zh-TW": {
    langLabel: "語言",
    stages: ["轉生異世界", "啟程", "初入城鎮", "與夥伴相遇", "冒險正式開始", "傳說的冒險者"],
    hero: {
      eyebrow: "轉生者的旅程",
      title: "轉生學校",
      sub: "角色轉生這件事 — 入學指南",
      cta: "開始旅程",
    },
    s0: {
      badge: "轉生異世界",
      mascot: "歡迎來到轉生學校！你剛剛轉生到了新世界。讓我們先學習這個世界的規則吧。",
      cards: [
        { icon: "📖", title: "Tensei 是什麼", body: "一個讓小說角色「真實存在」的對話工具。AI 會重現角色的個性、說話方式與世界觀。" },
        { icon: "✅", title: "關於作者認證", body: "Tensei 只使用經過作者認證的作品。尊重作者意願，在授權範圍內運作。" },
        { icon: "🔑", title: "為什麼需要 API Key", body: "這是與 AI 通訊的「通行證」。Key 只存在你的裝置中，不會傳送到我們的伺服器。" },
        { icon: "🔓", title: "開源的安心保障", body: "Tensei 的程式碼完全公開。你可以在 GitHub 親自確認我們不會偷取你的 Key。" },
      ],
      cta: "前往第一個任務 →",
    },
    s1: {
      badge: "啟程",
      mascot: "歡迎來到第一個任務。讓我們取得魔法鑰匙（API Key）。完全免費，不需要綁定信用卡！",
      goblin: "哥布林比想像中弱！",
      signupBtn: "前往申請頁面 →",
      keyFormat: "Key 格式:",
      keyPlaceholder: "將取得的 API Key 貼在這裡...",
      testBtn: "測試",
      testing: "測試中...",
      testOk: "✅ 驗證成功！",
      testFail: "❌ 驗證失敗。請確認 Key 是否正確。",
      modelSuggestion: "推薦模型:",
      copyBtn: "複製 Key",
      copied: "已複製！",
      copyHint: "複製後，在 Tensei 設定畫面點「＋ 新增模型」貼上即可。",
      multiKeyTip: "💡 可以設定多個 Key，Token 用完時自動切換。",
      noCorsHint: "⚠️ NIM 不支援從瀏覽器直接測試。請直接輸入 Key 並儲存，在 Tensei 中使用時會自動驗證。",
      urlLabel: "伺服器 URL",
      localModelLabel: "模型名稱",
      localHint: "⚠️ Ollama / LM Studio 必須在同一裝置上執行。",
      extFound: "🔌 已偵測到擴充功能 — 將自動儲存到擴充功能",
      extSaveBtn: "儲存到擴充功能",
      extSaving: "儲存到擴充功能中...",
      extSaved: "✅ 已儲存到擴充功能！設定畫面即將開啟。",
      pwaFound: "💾 將儲存到瀏覽器（未安裝擴充功能）",
      pwaSaveBtn: "儲存到瀏覽器",
      pwaSaving: "儲存中...",
      pwaSaved: "✅ 已儲存！繼續學習吧。",
      cities: [
        {
          dir: "東",
          name: "OpenRouter",
          sub: "商人之城 — 多條路線，新手推薦",
          badge: "✨ 新手推薦",
          color: "#22c55e",
          steps: [
            "開啟 openrouter.ai",
            "Sign up → 用 Google 或 Email 註冊",
            "Keys → Create Key → 輸入名稱",
            "複製 Key（以 sk-or-v1-... 開頭）",
          ],
        },
        {
          dir: "南",
          name: "Google AI Studio",
          sub: "學者聖殿 — 有 Google 帳號就能免費使用",
          badge: "🆓 完全免費",
          color: "#6366f1",
          steps: [
            "開啟 aistudio.google.com",
            "用 Google 帳號登入",
            "「Get API key」→「Create API key」",
            "複製 Key（以 AIza... 開頭）",
          ],
        },
        {
          dir: "北",
          name: "NVIDIA NIM",
          sub: "武人要塞 — 強大但適合進階用戶",
          badge: "⚔️ 進階用戶",
          color: "#d4af37",
          steps: [
            "開啟 build.nvidia.com",
            "用 NVIDIA 帳號註冊",
            "Get API Key → Generate Key",
            "複製 Key（以 nvapi-... 開頭）",
          ],
        },
        {
          dir: "西",
          name: "Ollama / LM Studio",
          sub: "在地隱者 — 本機運行，適合進階用戶",
          badge: "🏠 本機執行",
          color: "#f97316",
          steps: [
            "安裝 Ollama 或 LM Studio",
            "下載模型（例：llama3.2）",
            "啟動伺服器（通常 http://localhost:11434）",
            "在下方設定 URL 與模型名稱後儲存",
          ],
        },
      ],
      complete: "🎉 已取得 API Key！前往下一個城鎮。",
    },
    s2: {
      badge: "初入城鎮",
      mascot: "進入世界需要一道門。選擇適合你旅程風格的那道門。我們用《咒甲》作為教材。",
      novelName: "咒甲",
      novelAuthor: "Alex Lee 著 — カクヨム",
      tabs: [
        {
          name: "Chrome 擴充功能版",
          icon: "🧩",
          steps: [
            "在 カクヨム 開啟《咒甲》頁面",
            "點擊瀏覽器右上角的轉生圖示",
            "在側欄點擊「＋ 匯入」",
            "勾選想要匯入的章節",
            "按下「開始匯入」",
          ],
        },
        {
          name: "Web 版（PWA）",
          icon: "🌐",
          steps: [
            "開啟 Tensei Web 版",
            "點擊「＋ 匯入」",
            "貼上《咒甲》的 URL",
            "選擇章節",
            "按下「開始匯入」",
          ],
        },
      ],
      complete: "🌆 已抵達《咒甲》的世界！",
    },
    s3: {
      badge: "與夥伴相遇",
      mascot: "世界的居民在等著你。去跟他們說話吧。",
      steps: ["點擊作品卡片", "選擇角色", "輸入訊息並發送"],
      demoUser: "你",
      demoChar: "（《咒甲》的角色）",
      demoQ: "你好。你是什麼人？",
      demoA: "……這柄咒甲，居然被陌生人搭話。你，要麼膽量過人，要麼不知這世界的法則。",
      tips: [
        "💡 設定較多的上下文可以獲得更深入的回應",
        "💡 在角色設定畫面可以微調個性",
        "💡 用自然的語氣說話，角色也會自然地回應",
      ],
      complete: "🤝 與世界的居民建立了連結！",
    },
    s4: {
      badge: "冒險正式開始",
      mascot: "進階者的象徵。同時操控多個角色，演出屬於你的故事。",
      cards: [
        { icon: "🎭", title: "設定演員陣容", body: "選擇多個角色加入演出陣容，可以為每個角色設定不同的角色定位。" },
        { icon: "🎬", title: "指定場景", body: "設定在哪個場景、什麼情況下進行。角色們會依照世界的邏輯行動。" },
        { icon: "✏️", title: "參與故事", body: "可以選擇作為讀者觀察，或以角色的身份親自參與故事。" },
      ],
      complete: "🌟 進入演出模式！",
    },
    s5: {
      badge: "傳說的冒險者",
      mascot: "你的旅程來到最終章。但這不是結束，而是新的開始。",
      steps: [
        { icon: "📝", title: "書寫自己的故事", body: "作為讀者享受的你，現在輪到你來創造自己的世界了。" },
        { icon: "🌟", title: "以作者身份登錄", body: "如果你正在 カクヨム 或小說家になろう 寫作，可以申請加入著者 Portal。" },
        { icon: "🌍", title: "將世界提供給 Tensei", body: "讓讀者能與你作品中的角色對話，讓你的世界更加生動。" },
      ],
      cta: "前往著者 Portal →",
      ctaUrl: "/register",
      epilogue: "Tensei 的世界，因你的加入而擴展。",
    },
    footer: {
      install: "安裝擴充功能",
      pwa: "開啟 Web 版",
      portal: "前往著者 Portal",
      github: "GitHub",
    },
  },
  "zh-CN": {
    langLabel: "语言",
    stages: ["转生异世界", "启程", "初入城镇", "与伙伴相遇", "冒险正式开始", "传说的冒险者"],
    hero: { eyebrow: "转生者的旅程", title: "转生学校", sub: "角色转生这件事 — 入学指南", cta: "开始旅程" },
    s0: {
      badge: "转生异世界",
      mascot: "欢迎来到转生学校！你刚刚转生到了新世界。让我们先学习这个世界的规则吧。",
      cards: [
        { icon: "📖", title: "Tensei 是什么", body: "一个让小说角色「真实存在」的对话工具。AI 会重现角色的个性、说话方式与世界观。" },
        { icon: "✅", title: "关于作者认证", body: "Tensei 只使用经过作者认证的作品。尊重作者意愿，在授权范围内运作。" },
        { icon: "🔑", title: "为什么需要 API Key", body: "这是与 AI 通讯的「通行证」。Key 只存在你的设备中，不会传送到我们的服务器。" },
        { icon: "🔓", title: "开源的安心保障", body: "Tensei 的代码完全公开。你可以在 GitHub 亲自确认我们不会窃取你的 Key。" },
      ],
      cta: "前往第一个任务 →",
    },
    s1: {
      badge: "启程",
      mascot: "欢迎来到第一个任务。让我们获取魔法钥匙（API Key）。完全免费，无需绑定信用卡！",
      goblin: "哥布林比想象中弱！",
      signupBtn: "前往申请页面 →",
      keyFormat: "Key 格式:",
      keyPlaceholder: "将取得的 API Key 粘贴在这里...",
      testBtn: "测试",
      testing: "测试中...",
      testOk: "✅ 验证成功！",
      testFail: "❌ 验证失败。请确认 Key 是否正确。",
      modelSuggestion: "推荐模型:",
      copyBtn: "复制 Key",
      copied: "已复制！",
      copyHint: "复制后，在 Tensei 设置界面点「＋ 添加模型」粘贴即可。",
      multiKeyTip: "💡 可以设置多个 Key，Token 用完时自动切换。",
      noCorsHint: "⚠️ NIM 不支持从浏览器直接测试。请直接输入 Key 并保存，在 Tensei 中使用时会自动验证。",
      urlLabel: "服务器 URL",
      localModelLabel: "模型名称",
      localHint: "⚠️ Ollama / LM Studio 需在同一设备上运行。",
      extFound: "🔌 已检测到扩展程序 — 将自动保存到扩展程序",
      extSaveBtn: "保存到扩展程序",
      extSaving: "保存到扩展程序中...",
      extSaved: "✅ 已保存到扩展程序！设置界面即将打开。",
      pwaFound: "💾 将保存到浏览器（未安装扩展程序）",
      pwaSaveBtn: "保存到浏览器",
      pwaSaving: "保存中...",
      pwaSaved: "✅ 已保存！继续学习吧。",
      cities: [
        { dir: "东", name: "OpenRouter", sub: "商人之城 — 多条路线，新手推荐", badge: "✨ 新手推荐", color: "#22c55e", steps: ["打开 openrouter.ai", "Sign up → 用 Google 或 Email 注册", "Keys → Create Key → 输入名称", "复制 Key（以 sk-or-v1-... 开头）"] },
        { dir: "南", name: "Google AI Studio", sub: "学者圣殿 — 有 Google 账号即可免费使用", badge: "🆓 完全免费", color: "#6366f1", steps: ["打开 aistudio.google.com", "用 Google 账号登录", "「Get API key」→「Create API key」", "复制 Key（以 AIza... 开头）"] },
        { dir: "北", name: "NVIDIA NIM", sub: "武人要塞 — 强大但适合进阶用户", badge: "⚔️ 进阶用户", color: "#d4af37", steps: ["打开 build.nvidia.com", "用 NVIDIA 账号注册", "Get API Key → Generate Key", "复制 Key（以 nvapi-... 开头）"] },
        { dir: "西", name: "Ollama / LM Studio", sub: "本地隐者 — 本机运行，适合进阶用户", badge: "🏠 本机运行", color: "#f97316", steps: ["安装 Ollama 或 LM Studio", "下载模型（例：llama3.2）", "启动服务器（通常 http://localhost:11434）", "在下方设置 URL 与模型名称后保存"] },
      ],
      complete: "🎉 已获取 API Key！前往下一个城镇。",
    },
    s2: {
      badge: "初入城镇",
      mascot: "进入世界需要一扇门。选择适合你旅程风格的那扇门。我们用《咒甲》作为教材。",
      novelName: "咒甲", novelAuthor: "Alex Lee 著 — カクヨム",
      tabs: [
        { name: "Chrome 扩展版", icon: "🧩", steps: ["在 カクヨム 打开《咒甲》页面", "点击浏览器右上角的转生图标", "在侧栏点击「＋ 匯入」", "勾选要导入的章节", "按下「开始导入」"] },
        { name: "Web 版（PWA）", icon: "🌐", steps: ["打开 Tensei Web 版", "点击「＋ 匯入」", "粘贴《咒甲》的 URL", "选择章节", "按下「开始导入」"] },
      ],
      complete: "🌆 已抵达《咒甲》的世界！",
    },
    s3: { badge: "与伙伴相遇", mascot: "世界的居民在等着你。去和他们说话吧。", steps: ["点击作品卡片", "选择角色", "输入消息并发送"], demoUser: "你", demoChar: "（《咒甲》的角色）", demoQ: "你好。你是什么人？", demoA: "……这柄咒甲，居然被陌生人搭话。你，要么胆量过人，要么不知这世界的法则。", tips: ["💡 设置较多的上下文可以获得更深入的回应", "💡 在角色设置界面可以微调个性", "💡 用自然的语气说话，角色也会自然地回应"], complete: "🤝 与世界的居民建立了联结！" },
    s4: { badge: "冒险正式开始", mascot: "进阶者的象征。同时操控多个角色，演出属于你的故事。", cards: [{ icon: "🎭", title: "设定演员阵容", body: "选择多个角色加入演出阵容，可以为每个角色设定不同的定位。" }, { icon: "🎬", title: "指定场景", body: "设定在哪个场景、什么情况下进行。角色们会依照世界的逻辑行动。" }, { icon: "✏️", title: "参与故事", body: "可以作为读者观察，或以角色的身份亲自参与故事。" }], complete: "🌟 进入演出模式！" },
    s5: { badge: "传说的冒险者", mascot: "你的旅程来到最终章。但这不是结束，而是新的开始。", steps: [{ icon: "📝", title: "书写自己的故事", body: "作为读者享受的你，现在轮到你来创造自己的世界了。" }, { icon: "🌟", title: "以作者身份登录", body: "如果你正在 カクヨム 或小説家になろう 写作，可以申请加入著者 Portal。" }, { icon: "🌍", title: "将世界提供给 Tensei", body: "让读者能与你作品中的角色对话，让你的世界更加生动。" }], cta: "前往著者 Portal →", ctaUrl: "/register", epilogue: "Tensei 的世界，因你的加入而扩展。" },
    footer: { install: "安装扩展功能", pwa: "打开 Web 版", portal: "前往著者 Portal", github: "GitHub" },
  },
  en: {
    langLabel: "Language",
    stages: ["Reincarnated!", "First Quest", "New Town", "Meeting Allies", "True Adventure", "Legendary"],
    hero: { eyebrow: "A Reincarnator's Journey", title: "Tensei Academy", sub: "Characters Who Reincarnated — Enrollment Guide", cta: "Begin Your Journey" },
    s0: {
      badge: "Reincarnated!",
      mascot: "Welcome to Tensei Academy! You've just reincarnated into a new world. Let's learn the rules first.",
      cards: [
        { icon: "📖", title: "What is Tensei?", body: "A tool that lets you converse with novel characters as if they truly exist. AI recreates their personality, speech style, and world." },
        { icon: "✅", title: "Author Authorization", body: "Tensei only works with author-approved novels. We respect the creator's intent and operate within granted permissions." },
        { icon: "🔑", title: "Why an API Key?", body: "It's a pass for communicating with AI. The key is stored only on your device — never sent to our servers." },
        { icon: "🔓", title: "Open Source Trust", body: "All Tensei code is public on GitHub. You can verify yourself that we never steal your key." },
      ],
      cta: "Start First Quest →",
    },
    s1: {
      badge: "First Quest",
      mascot: "Welcome to your first quest. Let's get the magic key (API Key). It's free — no credit card needed!",
      goblin: "The goblin is weaker than it looks!",
      signupBtn: "Get API Key →",
      keyFormat: "Key format:",
      keyPlaceholder: "Paste your API Key here...",
      testBtn: "Test",
      testing: "Testing...",
      testOk: "✅ Key verified!",
      testFail: "❌ Verification failed. Please check your key.",
      modelSuggestion: "Suggested model:",
      copyBtn: "Copy Key",
      copied: "Copied!",
      copyHint: "After copying, open Tensei Settings → Add Model and paste it there.",
      multiKeyTip: "💡 You can add multiple keys and switch when one runs out of tokens.",
      noCorsHint: "⚠️ NIM blocks direct browser requests. Paste your key and save directly — it will be validated when Tensei first uses it.",
      urlLabel: "Server URL",
      localModelLabel: "Model Name",
      localHint: "⚠️ Ollama / LM Studio must be running on the same device.",
      extFound: "🔌 Extension detected — will save directly to extension",
      extSaveBtn: "Save to Extension",
      extSaving: "Saving to extension...",
      extSaved: "✅ Saved to extension! Settings panel opening.",
      pwaFound: "💾 Will save to browser storage (no extension installed)",
      pwaSaveBtn: "Save to Browser",
      pwaSaving: "Saving...",
      pwaSaved: "✅ Saved! Continue your journey.",
      cities: [
        { dir: "E", name: "OpenRouter", sub: "Merchant's City — Many routes, recommended for beginners", badge: "✨ Beginner Pick", color: "#22c55e", steps: ["Open openrouter.ai", "Sign up with Google or Email", "Keys → Create Key → Enter a name", "Copy key (starts with sk-or-v1-...)"] },
        { dir: "S", name: "Google AI Studio", sub: "Scholar's Sanctum — Free with a Google account", badge: "🆓 Totally Free", color: "#6366f1", steps: ["Open aistudio.google.com", "Sign in with Google", "Get API key → Create API key", "Copy key (starts with AIza...)"] },
        { dir: "N", name: "NVIDIA NIM", sub: "Warrior's Fortress — Powerful, for advanced users", badge: "⚔️ Advanced", color: "#d4af37", steps: ["Open build.nvidia.com", "Register NVIDIA account", "Get API Key → Generate Key", "Copy key (starts with nvapi-...)"] },
        { dir: "W", name: "Ollama / LM Studio", sub: "Local Hermit — Run AI on your own machine", badge: "🏠 Local", color: "#f97316", steps: ["Install Ollama or LM Studio", "Download a model (e.g. llama3.2)", "Start the server (usually http://localhost:11434)", "Enter the URL and model name below, then save"] },
      ],
      complete: "🎉 API Key obtained! Proceed to the next town.",
    },
    s2: {
      badge: "New Town",
      mascot: "You need a gate to enter the world. Choose the one that fits your style. We'll use 《呪甲》 as our tutorial novel.",
      novelName: "呪甲 (Jukou)",
      novelAuthor: "by Alex Lee — Kakuyomu",
      tabs: [
        { name: "Chrome Extension", icon: "🧩", steps: ["Open 呪甲 on Kakuyomu", "Click the Tensei icon in your browser toolbar", "Click「＋ Import」in the sidebar", "Check episodes to import", "Press「Start Import」"] },
        { name: "Web Version (PWA)", icon: "🌐", steps: ["Open Tensei Web", "Click「＋ Import」", "Paste the 呪甲 URL", "Select episodes", "Press「Start Import」"] },
      ],
      complete: "🌆 You've arrived in the world of 呪甲!",
    },
    s3: { badge: "Meeting Allies", mascot: "The world's inhabitants are waiting. Go talk to them.", steps: ["Click a work card", "Choose a character", "Type a message and send"], demoUser: "You", demoChar: "(Character from 呪甲)", demoQ: "Hello. Who are you?", demoA: "…That a stranger would address this Jukou. Either you're remarkably bold, or you know nothing of this world's laws.", tips: ["💡 More context = deeper, more accurate responses", "💡 Fine-tune personality in the character settings screen", "💡 Natural language gets natural responses"], complete: "🤝 Connection made with the world's residents!" },
    s4: { badge: "True Adventure", mascot: "The mark of an advanced adventurer. Control multiple characters and play out your own story.", cards: [{ icon: "🎭", title: "Set Up a Cast", body: "Add multiple characters to your cast. Define each one's role in the scene." }, { icon: "🎬", title: "Define the Scene", body: "Set where and what's happening. Characters act according to the world's logic." }, { icon: "✏️", title: "Join the Story", body: "Observe as a reader, or step in as a character yourself." }], complete: "🌟 Performance mode entered!" },
    s5: { badge: "Legendary", mascot: "Your journey reaches its final chapter. But this isn't an ending — it's a new beginning.", steps: [{ icon: "📝", title: "Write Your Own Story", body: "You've enjoyed stories as a reader. Now it's your turn to create a world." }, { icon: "🌟", title: "Register as an Author", body: "Writing on Kakuyomu or Syosetu? Apply to join the Author Portal." }, { icon: "🌍", title: "Share Your World with Tensei", body: "Let readers converse with your characters and bring your world to life." }], cta: "Author Portal →", ctaUrl: "/register", epilogue: "The world of Tensei grows with you in it." },
    footer: { install: "Install Extension", pwa: "Open Web Version", portal: "Author Portal", github: "GitHub" },
  },
} as const;

// ─── Provider config (order matches T.*.s1.cities) ───────────────────────────

const PROVIDER_CONFIG = [
  {
    signupUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-v1-",
    endpoint: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-001",
    modelLabel: "Gemini 2.0 Flash (OpenRouter)",
    noCors: false,
  },
  {
    signupUrl: "https://aistudio.google.com/app/apikey",
    keyPrefix: "AIza",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemma-4-31b-it",
    modelLabel: "Gemma 4 31B",
    noCors: false,
  },
  {
    signupUrl: "https://build.nvidia.com/explore/discover",
    keyPrefix: "nvapi-",
    endpoint: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.1-8b-instruct",
    modelLabel: "Llama 3.1 8B Instruct",
    noCors: true,
  },
  {
    signupUrl: "",
    keyPrefix: "",
    endpoint: "",
    defaultModel: "llama3.2",
    defaultUrl: "http://localhost:11434/v1",
    modelLabel: "Ollama / LM Studio",
    noCors: false,
    isLocal: true,
  },
] as const;

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useReveal(threshold = 0.25) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function useTypewriter(text: string, speed = 40, active = false) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    if (!active) return;
    setDisplayed("");
    let i = 0;
    const timer = setInterval(() => {
      if (i >= text.length) { clearInterval(timer); return; }
      setDisplayed(text.slice(0, ++i));
    }, speed);
    return () => clearInterval(timer);
  }, [text, active]);
  return displayed;
}

// ─── Particles ────────────────────────────────────────────────────────────────

function ParticleField() {
  const particles = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      delay: Math.random() * 6,
      dur: Math.random() * 4 + 3,
      opacity: Math.random() * 0.6 + 0.2,
    })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            background: p.id % 3 === 0 ? "#d4af37" : p.id % 3 === 1 ? "#a5b4fc" : "#fff",
            opacity: p.opacity,
            animation: `guide-twinkle ${p.dur}s ${p.delay}s infinite ease-in-out`,
          }}
        />
      ))}
    </div>
  );
}

// ─── ProgressNav ──────────────────────────────────────────────────────────────

function ProgressNav({ current, t }: { current: number; t: typeof T["ja"] }) {
  const icons = ["🌀", "⚔️", "🏙️", "🤝", "🎭", "👑"];
  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col items-center gap-0">
      {t.stages.map((label, i) => (
        <div key={i} className="flex flex-col items-center">
          <a
            href={`#section-${i}`}
            title={label}
            className="group flex flex-col items-center"
            style={{ scrollBehavior: "smooth" }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm transition-all duration-500"
              style={{
                background: i <= current ? "rgba(212,175,55,0.2)" : "rgba(255,255,255,0.05)",
                border: i === current
                  ? "2px solid #d4af37"
                  : i < current
                  ? "2px solid rgba(212,175,55,0.5)"
                  : "2px solid rgba(255,255,255,0.15)",
                boxShadow: i === current ? "0 0 12px rgba(212,175,55,0.6)" : "none",
                animation: i === current ? "guide-glow 2s ease-in-out infinite" : "none",
              }}
            >
              <span>{icons[i]}</span>
            </div>
            <span
              className="absolute left-12 whitespace-nowrap text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ background: "rgba(0,0,0,0.8)", color: "#d4af37", border: "1px solid rgba(212,175,55,0.3)" }}
            >
              {label}
            </span>
          </a>
          {i < 5 && (
            <div
              className="w-px h-6 transition-all duration-700"
              style={{ background: i < current ? "rgba(212,175,55,0.5)" : "rgba(255,255,255,0.1)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── RpgCard ──────────────────────────────────────────────────────────────────

function RpgCard({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div
      className={`rounded-lg p-4 ${className}`}
      style={{
        background: "rgba(13,13,36,0.85)",
        border: "1px solid rgba(212,175,55,0.3)",
        boxShadow: "0 0 20px rgba(0,0,0,0.5), inset 0 0 30px rgba(212,175,55,0.03)",
        animation: `guide-reveal 0.6s ${delay}s both ease-out`,
      }}
    >
      {children}
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ rank, badge, icon }: { rank: number; badge: string; icon: string }) {
  const { ref, visible } = useReveal();
  return (
    <div ref={ref} className="flex items-center gap-4 mb-8">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
        style={{
          background: "rgba(212,175,55,0.1)",
          border: "2px solid #d4af37",
          boxShadow: "0 0 20px rgba(212,175,55,0.3)",
          animation: visible ? "guide-badge-pop 0.6s both ease-out" : "none",
        }}
      >
        {icon}
      </div>
      <div>
        <div className="text-xs tracking-widest uppercase mb-1" style={{ color: "rgba(212,175,55,0.6)" }}>
          Stage {rank}
        </div>
        <h2 className="text-2xl font-bold" style={{ color: "#d4af37", textShadow: "0 0 20px rgba(212,175,55,0.4)" }}>
          {badge}
        </h2>
      </div>
    </div>
  );
}

// ─── MascotBubble ─────────────────────────────────────────────────────────────

function MascotBubble({ text, active }: { text: string; active: boolean }) {
  const displayed = useTypewriter(text, 35, active);
  return (
    <div className="flex items-start gap-3 mb-8">
      <div
        className="w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-2xl"
        style={{
          background: "rgba(212,175,55,0.15)",
          border: "2px solid rgba(212,175,55,0.4)",
          animation: "guide-float 3s ease-in-out infinite",
        }}
      >
        🦊
      </div>
      <div
        className="rounded-lg px-4 py-3 text-sm leading-relaxed flex-1 max-w-xl"
        style={{
          background: "rgba(99,102,241,0.1)",
          border: "1px solid rgba(99,102,241,0.3)",
          color: "#c7d2fe",
        }}
      >
        {displayed}
        {active && displayed.length < text.length && (
          <span className="inline-block w-1 h-4 ml-1 align-text-bottom animate-pulse" style={{ background: "#6366f1" }} />
        )}
      </div>
    </div>
  );
}

// ─── Section 0 ────────────────────────────────────────────────────────────────

function Section0({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const s = t.s0;
  return (
    <section id="section-0" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={0} badge={s.badge} icon="🌀" />
      <MascotBubble text={s.mascot} active={active} />
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {s.cards.map((c, i) => (
          <RpgCard key={i} delay={i * 0.1}>
            <div className="text-2xl mb-2">{c.icon}</div>
            <div className="font-semibold mb-1 text-white">{c.title}</div>
            <div className="text-sm" style={{ color: "#9ca3af" }}>{c.body}</div>
          </RpgCard>
        ))}
      </div>
      <div className="text-center">
        <a
          href="#section-1"
          className="inline-block px-8 py-3 rounded font-semibold transition-all"
          style={{
            background: "rgba(212,175,55,0.15)",
            border: "1px solid #d4af37",
            color: "#d4af37",
            boxShadow: "0 0 20px rgba(212,175,55,0.2)",
          }}
        >
          {s.cta}
        </a>
      </div>
    </section>
  );
}

// ─── Section 1 (API Key) ──────────────────────────────────────────────────────

type TestState = "idle" | "testing" | "ok" | "fail";
type SaveState = "idle" | "saving" | "done";

function Section1({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [localUrl, setLocalUrl] = useState("http://localhost:11434/v1");
  const [localModel, setLocalModel] = useState("llama3.2");
  const extId = document.documentElement.getAttribute("data-tensei-ext-id");
  const s = t.s1;

  function handleSelectCity(i: number) {
    if (selected !== i) {
      setSelected(i);
      setApiKey("");
      setTestState("idle");
      setTestMsg("");
      setSaveState("idle");
      setLocalUrl("http://localhost:11434/v1");
      setLocalModel("llama3.2");
    } else {
      setSelected(null);
    }
  }

  async function handleTest() {
    if (selected === null || !apiKey.trim()) return;
    const provider = PROVIDER_CONFIG[selected];
    setTestState("testing");
    setTestMsg("");
    try {
      const res = await fetch(`${provider.endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: provider.defaultModel,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      });
      if (res.ok) {
        setTestState("ok");
      } else {
        const text = await res.text().catch(() => "");
        setTestState("fail");
        setTestMsg(text.slice(0, 150));
      }
    } catch (e) {
      setTestState("fail");
      setTestMsg(String(e).slice(0, 150));
    }
  }

  function handleSave() {
    if (selected === null || !apiKey.trim()) return;
    const provider = PROVIDER_CONFIG[selected];
    const model = {
      name: provider.modelLabel,
      endpoint_url: provider.endpoint,
      api_key: apiKey.trim(),
      model_name: provider.defaultModel,
    };
    setSaveState("saving");

    if (extId && (window as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage) {
      // Case 1: extension installed — send via externally_connectable
      (window as unknown as { chrome: { runtime: { sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void } } })
        .chrome.runtime.sendMessage(extId, { type: "SAVE_MODEL", model }, () => {
          setSaveState("done");
        });
    } else {
      // Case 2: no extension — save to localStorage
      try {
        const existing = JSON.parse(localStorage.getItem("tensei_pending_model") ?? "null");
        if (!existing) localStorage.setItem("tensei_pending_model", JSON.stringify(model));
      } catch { /* ignore */ }
      setSaveState("done");
    }
  }

  function handleLocalSave() {
    if (!localUrl.trim() || !localModel.trim()) return;
    const model = {
      name: `Ollama (${localModel.trim()})`,
      endpoint_url: localUrl.trim(),
      api_key: "",
      model_name: localModel.trim(),
    };
    setSaveState("saving");
    if (extId && (window as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage) {
      (window as unknown as { chrome: { runtime: { sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void } } })
        .chrome.runtime.sendMessage(extId, { type: "SAVE_MODEL", model }, () => { setSaveState("done"); });
    } else {
      try {
        const existing = JSON.parse(localStorage.getItem("tensei_pending_model") ?? "null");
        if (!existing) localStorage.setItem("tensei_pending_model", JSON.stringify(model));
      } catch { /* ignore */ }
      setSaveState("done");
    }
  }

  const city = selected !== null ? s.cities[selected] : null;
  const provider = selected !== null ? PROVIDER_CONFIG[selected] : null;
  const isLocalCity = selected === 3;
  const canTest = !isLocalCity && apiKey.trim().length > 8 && testState !== "testing" && !provider?.noCors;
  const showSave = !isLocalCity && (testState === "ok" || provider?.noCors === true) && apiKey.trim().length > 8;

  return (
    <section id="section-1" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={1} badge={s.badge} icon="⚔️" />
      <MascotBubble text={s.mascot} active={active} />

      {/* Goblin hint */}
      <div
        className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full mb-8 w-fit"
        style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#86efac" }}
      >
        <span style={{ animation: "guide-float 1.5s ease-in-out infinite" }}>👺</span>
        <span>{s.goblin}</span>
      </div>

      {/* Cities */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {s.cities.map((c, i) => (
          <button
            key={i}
            onClick={() => handleSelectCity(i)}
            className="text-left rounded-lg p-4 transition-all duration-300"
            style={{
              background: selected === i ? `${c.color}18` : "rgba(13,13,36,0.85)",
              border: `1px solid ${selected === i ? c.color : "rgba(212,175,55,0.2)"}`,
              boxShadow: selected === i ? `0 0 20px ${c.color}30` : "none",
            }}
          >
            <div className="text-3xl mb-2 font-bold" style={{ color: c.color }}>{c.dir}</div>
            <div className="font-semibold text-white text-sm mb-1">{c.name}</div>
            <div className="text-xs mb-3" style={{ color: "#6b7280" }}>{c.sub}</div>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${c.color}20`, color: c.color, border: `1px solid ${c.color}40` }}>
              {c.badge}
            </span>
          </button>
        ))}
      </div>

      {/* Interactive panel */}
      {selected !== null && city && provider && (
        <RpgCard className="mb-6 space-y-5" delay={0}>
          {/* Header */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="font-semibold text-sm" style={{ color: "#d4af37" }}>{city.name}</div>
            {!isLocalCity && (
              <a
                href={provider.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded font-medium transition-all"
                style={{ background: `${city.color}20`, border: `1px solid ${city.color}60`, color: city.color }}
              >
                {s.signupBtn}
              </a>
            )}
          </div>

          {/* Steps */}
          <ol className="space-y-2">
            {city.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm" style={{ color: "#e5e7eb" }}>
                <span
                  className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
                  style={{ background: city.color, color: "#000" }}
                >
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <div style={{ borderTop: "1px solid rgba(212,175,55,0.15)" }} />

          {isLocalCity ? (
            /* Local LLM: URL + model inputs */
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "#6b7280" }}>{s.urlLabel}</label>
                <input
                  value={localUrl}
                  onChange={e => setLocalUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="w-full rounded px-3 py-2 text-sm font-mono outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e5e7eb" }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#6b7280" }}>{s.localModelLabel}</label>
                <input
                  value={localModel}
                  onChange={e => setLocalModel(e.target.value)}
                  placeholder="llama3.2"
                  className="w-full rounded px-3 py-2 text-sm font-mono outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e5e7eb" }}
                />
              </div>
              <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)", color: "#fb923c" }}>
                {s.localHint}
              </div>
              <div className="text-xs px-2 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "#6b7280" }}>
                {extId ? s.extFound : s.pwaFound}
              </div>
              <button
                onClick={handleLocalSave}
                disabled={saveState !== "idle"}
                className="w-full py-2.5 rounded font-semibold text-sm transition-all"
                style={{
                  background: (saveState as SaveState) === "done" ? "rgba(34,197,94,0.2)" : `${city.color}25`,
                  border: `1px solid ${(saveState as SaveState) === "done" ? "#22c55e" : city.color}`,
                  color: (saveState as SaveState) === "done" ? "#86efac" : city.color,
                  cursor: saveState === "idle" ? "pointer" : "default",
                }}
              >
                {(saveState as SaveState) === "saving"
                  ? (extId ? s.extSaving : s.pwaSaving)
                  : (saveState as SaveState) === "done"
                  ? (extId ? s.extSaved : s.pwaSaved)
                  : (extId ? s.extSaveBtn : s.pwaSaveBtn)}
              </button>
            </div>
          ) : (
            /* Cloud provider: API key flow */
            <>
              {/* NIM: no-CORS warning */}
              {provider.noCors && (
                <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
                  {s.noCorsHint}
                </div>
              )}

              {/* Key format hint */}
              <div className="text-xs" style={{ color: "#6b7280" }}>
                {s.keyFormat}{" "}
                <code className="px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,255,255,0.06)", color: "#d4af37" }}>
                  {provider.keyPrefix}xxxxxxxx...
                </code>
              </div>

              {/* Key input + test */}
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestState("idle"); setTestMsg(""); }}
                  placeholder={s.keyPlaceholder}
                  className="flex-1 rounded px-3 py-2 text-sm font-mono outline-none"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${testState === "ok" ? "#22c55e" : testState === "fail" ? "#ef4444" : "rgba(255,255,255,0.12)"}`,
                    color: "#e5e7eb",
                  }}
                />
                {!provider.noCors && (
                  <button
                    onClick={handleTest}
                    disabled={!canTest}
                    className="px-4 py-2 rounded text-sm font-medium transition-all flex-shrink-0"
                    style={{
                      background: canTest ? `${city.color}20` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${canTest ? city.color : "rgba(255,255,255,0.1)"}`,
                      color: canTest ? city.color : "#4b5563",
                      cursor: canTest ? "pointer" : "not-allowed",
                    }}
                  >
                    {testState === "testing" ? s.testing : s.testBtn}
                  </button>
                )}
              </div>

              {/* Test result */}
              {testState === "ok" && (
                <div className="text-sm font-medium" style={{ color: "#86efac" }}>{s.testOk}</div>
              )}
              {testState === "fail" && (
                <div className="space-y-1">
                  <div className="text-sm" style={{ color: "#f87171" }}>{s.testFail}</div>
                  {testMsg && <div className="text-xs font-mono break-all" style={{ color: "#6b7280" }}>{testMsg}</div>}
                </div>
              )}

              {/* Save button — shown after test OK, or immediately for noCors */}
              {showSave && (
                <div className="space-y-2">
                  <div className="text-xs" style={{ color: "#6b7280" }}>
                    {s.modelSuggestion}{" "}
                    <code className="px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(255,255,255,0.06)", color: "#d4af37" }}>
                      {provider.defaultModel}
                    </code>
                    {" "}— {provider.modelLabel}
                  </div>
                  <div className="text-xs px-2 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "#6b7280" }}>
                    {extId ? s.extFound : s.pwaFound}
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saveState !== "idle"}
                    className="w-full py-2.5 rounded font-semibold text-sm transition-all"
                    style={{
                      background: (saveState as SaveState) === "done" ? "rgba(34,197,94,0.2)" : `${city.color}25`,
                      border: `1px solid ${(saveState as SaveState) === "done" ? "#22c55e" : city.color}`,
                      color: (saveState as SaveState) === "done" ? "#86efac" : city.color,
                      cursor: saveState === "idle" ? "pointer" : "default",
                    }}
                  >
                    {(saveState as SaveState) === "saving"
                      ? (extId ? s.extSaving : s.pwaSaving)
                      : (saveState as SaveState) === "done"
                      ? (extId ? s.extSaved : s.pwaSaved)
                      : (extId ? s.extSaveBtn : s.pwaSaveBtn)}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="text-xs" style={{ color: "#4b5563" }}>{s.multiKeyTip}</div>
        </RpgCard>
      )}

      {(saveState as SaveState) === "done" && (
        <div className="text-center text-sm" style={{ color: "#86efac" }}>{s.complete}</div>
      )}
    </section>
  );
}

// ─── Section 2 (Import) ───────────────────────────────────────────────────────

function Section2({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const [tab, setTab] = useState(0);
  const s = t.s2;
  return (
    <section id="section-2" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={2} badge={s.badge} icon="🏙️" />
      <MascotBubble text={s.mascot} active={active} />

      {/* Novel badge */}
      <RpgCard className="mb-6 flex items-center gap-4">
        <div className="w-10 h-10 rounded flex items-center justify-center text-xl" style={{ background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.3)" }}>
          📚
        </div>
        <div>
          <div className="font-bold text-white">{s.novelName}</div>
          <div className="text-xs" style={{ color: "#9ca3af" }}>{s.novelAuthor}</div>
          <a
            href="https://kakuyomu.jp/works/2912051596077215753"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono break-all"
            style={{ color: "#6366f1" }}
          >
            kakuyomu.jp/works/2912051596077215753
          </a>
        </div>
      </RpgCard>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {s.tabs.map((tab_, i) => (
          <button
            key={i}
            onClick={() => setTab(i)}
            className="px-4 py-2 rounded text-sm transition-all"
            style={{
              background: tab === i ? "rgba(212,175,55,0.15)" : "transparent",
              border: tab === i ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.1)",
              color: tab === i ? "#d4af37" : "#9ca3af",
            }}
          >
            {tab_.icon} {tab_.name}
          </button>
        ))}
      </div>

      <RpgCard>
        <ol className="space-y-3">
          {s.tabs[tab].steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm" style={{ color: "#e5e7eb" }}>
              <span
                className="w-6 h-6 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
                style={{ background: "rgba(212,175,55,0.2)", color: "#d4af37", border: "1px solid rgba(212,175,55,0.3)" }}
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </RpgCard>

      <div className="text-center mt-6 text-sm" style={{ color: "#fbbf24" }}>{s.complete}</div>
    </section>
  );
}

// ─── Section 3 (Chat) ─────────────────────────────────────────────────────────

function Section3({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const s = t.s3;
  const [showReply, setShowReply] = useState(false);
  const reply = useTypewriter(s.demoA, 45, showReply);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setShowReply(true), 2000);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <section id="section-3" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={3} badge={s.badge} icon="🤝" />
      <MascotBubble text={s.mascot} active={active} />

      {/* Steps */}
      <div className="flex gap-4 mb-8 flex-wrap">
        {s.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.4)" }}>{i + 1}</span>
            <span style={{ color: "#e5e7eb" }}>{step}</span>
            {i < s.steps.length - 1 && <span style={{ color: "#374151" }}>→</span>}
          </div>
        ))}
      </div>

      {/* Chat demo */}
      <RpgCard className="mb-6">
        <div className="text-xs mb-4 tracking-wide uppercase" style={{ color: "rgba(212,175,55,0.5)" }}>Demo</div>
        {/* User message */}
        <div className="flex justify-end mb-4">
          <div className="max-w-xs">
            <div className="text-xs mb-1 text-right" style={{ color: "#6b7280" }}>{s.demoUser}</div>
            <div className="px-4 py-2 rounded-lg text-sm" style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.3)", color: "#c7d2fe" }}>
              {s.demoQ}
            </div>
          </div>
        </div>
        {/* Character reply */}
        <div className="flex gap-3 mb-2">
          <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm" style={{ background: "rgba(212,175,55,0.15)", border: "1px solid rgba(212,175,55,0.3)" }}>⚔️</div>
          <div className="flex-1">
            <div className="text-xs mb-1" style={{ color: "#6b7280" }}>{s.demoChar}</div>
            <div className="px-4 py-2 rounded-lg text-sm min-h-[2.5rem]" style={{ background: "rgba(13,13,36,0.9)", border: "1px solid rgba(212,175,55,0.2)", color: "#e5e7eb" }}>
              {reply}
              {showReply && reply.length < s.demoA.length && (
                <span className="inline-block w-1 h-4 ml-0.5 align-text-bottom animate-pulse" style={{ background: "#d4af37" }} />
              )}
            </div>
          </div>
        </div>
      </RpgCard>

      {/* Tips */}
      <div className="space-y-2">
        {s.tips.map((tip, i) => (
          <div key={i} className="text-sm px-4 py-2 rounded" style={{ background: "rgba(255,255,255,0.03)", color: "#9ca3af" }}>
            {tip}
          </div>
        ))}
      </div>

      <div className="text-center mt-6 text-sm" style={{ color: "#86efac" }}>{s.complete}</div>
    </section>
  );
}

// ─── Section 4 (Performance) ──────────────────────────────────────────────────

function Section4({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const s = t.s4;
  return (
    <section id="section-4" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={4} badge={s.badge} icon="🎭" />
      <MascotBubble text={s.mascot} active={active} />
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {s.cards.map((c, i) => (
          <RpgCard key={i} delay={i * 0.15}>
            <div className="text-3xl mb-3">{c.icon}</div>
            <div className="font-semibold text-white mb-2">{c.title}</div>
            <div className="text-sm" style={{ color: "#9ca3af" }}>{c.body}</div>
          </RpgCard>
        ))}
      </div>
      <div className="text-center text-sm" style={{ color: "#fbbf24" }}>{s.complete}</div>
    </section>
  );
}

// ─── Section 5 (Legend) ───────────────────────────────────────────────────────

function Section5({ t, active }: { t: typeof T["ja"]; active: boolean }) {
  const s = t.s5;
  return (
    <section id="section-5" className="min-h-screen flex flex-col justify-center py-24 px-6 lg:px-24 max-w-4xl mx-auto">
      <SectionHeader rank={5} badge={s.badge} icon="👑" />
      <MascotBubble text={s.mascot} active={active} />

      <div className="space-y-4 mb-8">
        {s.steps.map((step, i) => (
          <RpgCard key={i} delay={i * 0.1} className="flex gap-4">
            <div className="text-3xl">{step.icon}</div>
            <div>
              <div className="font-semibold text-white mb-1">{step.title}</div>
              <div className="text-sm" style={{ color: "#9ca3af" }}>{step.body}</div>
            </div>
          </RpgCard>
        ))}
      </div>

      <div className="text-center">
        <p className="text-sm mb-6" style={{ color: "#9ca3af" }}>{s.epilogue}</p>
        <a
          href={s.ctaUrl}
          className="inline-block px-10 py-4 rounded font-bold text-lg transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(212,175,55,0.2) 0%, rgba(99,102,241,0.2) 100%)",
            border: "1px solid #d4af37",
            color: "#d4af37",
            boxShadow: "0 0 30px rgba(212,175,55,0.25)",
            animation: "guide-glow 2s ease-in-out infinite",
          }}
        >
          {s.cta}
        </a>
      </div>
    </section>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LANGS: { key: Lang; label: string }[] = [
  { key: "ja", label: "日本語" },
  { key: "zh-TW", label: "繁中" },
  { key: "zh-CN", label: "简中" },
  { key: "en", label: "EN" },
];

export function GuidePage() {
  const [lang, setLang] = useState<Lang>("ja");
  const [currentSection, setCurrentSection] = useState(0);
  const [activeSection, setActiveSection] = useState(-1);
  const t = T[lang] as typeof T["ja"];

  // Track scroll position → currentSection
  useEffect(() => {
    const onScroll = () => {
      for (let i = 5; i >= 0; i--) {
        const el = document.getElementById(`section-${i}`);
        if (!el) continue;
        if (window.scrollY >= el.offsetTop - window.innerHeight / 2) {
          setCurrentSection(i);
          break;
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Activate mascot typewriter when section scrolls into view
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const handleReveal = useCallback((idx: number) => {
    setActiveSection(prev => (prev < idx ? idx : prev));
  }, []);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (let i = 0; i <= 5; i++) {
      const el = document.getElementById(`section-${i}`);
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) handleReveal(i); },
        { threshold: 0.2 }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach(o => o.disconnect());
  }, [handleReveal]);

  return (
    <>
      {/* Injected CSS */}
      <style>{`
        @keyframes guide-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes guide-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes guide-glow {
          0%, 100% { box-shadow: 0 0 10px rgba(212,175,55,0.3); }
          50% { box-shadow: 0 0 25px rgba(212,175,55,0.7), 0 0 50px rgba(212,175,55,0.2); }
        }
        @keyframes guide-reveal {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes guide-badge-pop {
          0% { transform: scale(0) rotate(-180deg); opacity: 0; }
          70% { transform: scale(1.2) rotate(10deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes guide-hero-in {
          from { opacity: 0; transform: translateY(40px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        html { scroll-behavior: smooth; }
        .guide-bg { background: radial-gradient(ellipse at 50% 0%, #0d0d2b 0%, #060614 60%); }
      `}</style>

      <div className="guide-bg min-h-screen text-white" style={{ fontFamily: "system-ui, sans-serif" }}>
        {/* Language switcher */}
        <div className="fixed top-4 right-4 z-50 flex gap-1">
          {LANGS.map(l => (
            <button
              key={l.key}
              onClick={() => setLang(l.key)}
              className="px-2.5 py-1 rounded text-xs transition-all"
              style={{
                background: lang === l.key ? "rgba(212,175,55,0.2)" : "rgba(0,0,0,0.5)",
                border: lang === l.key ? "1px solid #d4af37" : "1px solid rgba(255,255,255,0.1)",
                color: lang === l.key ? "#d4af37" : "#9ca3af",
              }}
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Progress nav */}
        <ProgressNav current={currentSection} t={t} />

        {/* ── HERO ── */}
        <section
          className="relative h-screen flex flex-col items-center justify-center overflow-hidden text-center px-6"
          style={{ borderBottom: "1px solid rgba(212,175,55,0.1)" }}
        >
          <ParticleField />
          {/* Glow orb */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
            style={{
              width: 500, height: 500,
              background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
            }}
          />
          <div style={{ animation: "guide-hero-in 1.2s 0.2s both ease-out" }}>
            <p className="text-xs tracking-[0.4em] uppercase mb-4" style={{ color: "rgba(212,175,55,0.7)" }}>
              {t.hero.eyebrow}
            </p>
            <h1
              className="text-6xl sm:text-8xl font-bold mb-4"
              style={{
                color: "#d4af37",
                textShadow: "0 0 40px rgba(212,175,55,0.5), 0 0 80px rgba(212,175,55,0.2)",
                fontFamily: "serif",
              }}
            >
              {t.hero.title}
            </h1>
            <p className="text-lg mb-12" style={{ color: "#9ca3af" }}>{t.hero.sub}</p>
            <a
              href="#section-0"
              className="inline-block px-10 py-4 rounded font-semibold text-lg transition-all"
              style={{
                background: "rgba(212,175,55,0.15)",
                border: "1px solid #d4af37",
                color: "#d4af37",
                boxShadow: "0 0 30px rgba(212,175,55,0.2)",
                animation: "guide-glow 2s ease-in-out infinite",
              }}
            >
              {t.hero.cta}
            </a>
          </div>
          {/* Scroll hint */}
          <div
            className="absolute bottom-8 text-xs tracking-widest uppercase"
            style={{ color: "rgba(255,255,255,0.2)", animation: "guide-float 2s ease-in-out infinite" }}
          >
            ↓ scroll
          </div>
        </section>

        {/* Section divider */}
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)" }} />

        {/* ── SECTIONS ── */}
        <Section0 t={t} active={activeSection >= 0} />
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)" }} />
        <Section1 t={t} active={activeSection >= 1} />
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)" }} />
        <Section2 t={t} active={activeSection >= 2} />
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)" }} />
        <Section3 t={t} active={activeSection >= 3} />
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)" }} />
        <Section4 t={t} active={activeSection >= 4} />
        <div className="h-px mx-auto max-w-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.2), transparent)" }} />
        <Section5 t={t} active={activeSection >= 5} />

        {/* ── FOOTER ── */}
        <footer className="py-16 px-6 text-center" style={{ borderTop: "1px solid rgba(212,175,55,0.1)" }}>
          <p className="text-xs mb-8 tracking-[0.3em] uppercase" style={{ color: "rgba(212,175,55,0.4)" }}>
            — Tensei —
          </p>
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {[
              { label: t.footer.install, href: "https://chromewebstore.google.com/detail/%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E3%81%8C%E8%BB%A2%E7%94%9F%E3%81%97%E3%81%A6%E3%81%8D%E3%81%9F%E4%BB%B6/fmbhoboogphkfenpekeklmkkjhbcfmmc", external: true },
              { label: t.footer.pwa, href: "https://tensei-portal.pages.dev/", external: true },
              { label: t.footer.portal, href: "/register", external: false },
              { label: t.footer.github, href: "https://github.com/oshitennsei/tensei", external: true },
            ].map(link => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="px-4 py-2 rounded text-sm transition-all"
                style={{
                  border: "1px solid rgba(212,175,55,0.2)",
                  color: "#9ca3af",
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.color = "#d4af37"; (e.target as HTMLElement).style.borderColor = "rgba(212,175,55,0.5)"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.color = "#9ca3af"; (e.target as HTMLElement).style.borderColor = "rgba(212,175,55,0.2)"; }}
              >
                {link.label}
              </a>
            ))}
          </div>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.1)" }}>
            © 2026 Tensei · Open Source
          </p>
        </footer>
      </div>
    </>
  );
}

export interface ChangelogEntry {
  version: string;
  changes: {
    ja: string[];
    "zh-tw": string[];
    "zh-cn": string[];
    en: string[];
  };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.0",
    changes: {
      ja: [
        "🔗 ポータル連携 — 作者がキャラクター設定・章サマリーを公開、読者が「作者版を取得」で同期",
        "✏️ 地名・物品・組織の編集機能を追加、章ごとの状態変化も記録可能に",
        "🔍 RAG 改善 — アイテムの状態変化（占領・破壊・譲渡）をコンテキストに反映",
        "🛡️ ネタバレ防止を強化 — 時系列より後の情報がキャラクターに漏れにくくなりました",
      ],
      "zh-tw": [
        "🔗 Portal 連動 — 作者可發布角色設定・章節摘要，讀者可「取得作者版」同步",
        "✏️ 新增地點・物品・組織的編輯功能，可記錄各章節的狀態變化",
        "🔍 RAG 改善 — 物品狀態變化（佔領・破壞・轉移）會反映至對話上下文",
        "🛡️ 強化防雷 — 角色較不易獲知時間線後方的情報",
      ],
      "zh-cn": [
        "🔗 Portal 联动 — 作者可发布角色设定・章节摘要，读者可「获取作者版」同步",
        "✏️ 新增地点・物品・组织的编辑功能，可记录各章节的状态变化",
        "🔍 RAG 改善 — 物品状态变化（占领・破坏・转移）会反映至对话上下文",
        "🛡️ 强化防剧透 — 角色较不易获知时间线后方的情报",
      ],
      en: [
        "🔗 Portal sync — authors can publish character settings & summaries; readers pull with 'Get Author Version'",
        "✏️ Edit locations, items & orgs — including per-chapter state history (destroyed, captured, transferred, etc.)",
        "🔍 RAG improvement — item state changes now reflected in character context",
        "🛡️ Stronger spoiler guard — characters less likely to receive future-timeline information",
      ],
    },
  },
  {
    version: "0.2.0",
    changes: {
      ja: [
        "🏠 Ollama / LM Studio 対応 — ローカル LLM をキー不要で接続できるように",
        "🌍 ポータルホームページを多言語化（日本語・繁中・简中・英語）",
        "🖼 PWA（ブラウザ版）の背景表示を修正",
        "⚙️ 埋め込みモデルのプリセット選択時に model_name を自動補完",
      ],
      "zh-tw": [
        "🏠 支援 Ollama / LM Studio — 免 API Key 連接本地 LLM",
        "🌍 入口網站首頁支援多語言（日/繁/簡/英）",
        "🖼 修正 PWA（瀏覽器版）背景顯示問題",
        "⚙️ 選擇嵌入式模型預設時自動補全 model_name",
      ],
      "zh-cn": [
        "🏠 支持 Ollama / LM Studio — 免 API Key 连接本地 LLM",
        "🌍 入口网站首页支持多语言（日/繁/简/英）",
        "🖼 修正 PWA（浏览器版）背景显示问题",
        "⚙️ 选择嵌入式模型预设时自动补全 model_name",
      ],
      en: [
        "🏠 Ollama / LM Studio support — connect local LLMs without an API key",
        "🌍 Portal homepage now supports multiple languages (ja / zh-TW / zh-CN / en)",
        "🖼 Fixed background display in PWA (browser version)",
        "⚙️ Embedding model preset now auto-fills model_name on selection",
      ],
    },
  },
  {
    version: "0.1.0",
    changes: {
      ja: [
        "転生学校（入学案内）を追加",
        "ポータルからAPIキーを直接保存できるように",
        "初回起動時のウェルカムダイアログを追加",
        "著者ポータルとの連携機能を改善",
      ],
      "zh-tw": [
        "新增轉生學校（入學指南）",
        "可從入口網站直接儲存 API 金鑰",
        "新增首次啟動歡迎視窗",
        "改善著者入口網站的連動功能",
      ],
      "zh-cn": [
        "新增转生学校（入学指南）",
        "可从门户网站直接保存 API 密钥",
        "新增首次启动欢迎弹窗",
        "改善著者门户网站的联动功能",
      ],
      en: [
        "Added Tensei Academy (enrollment guide)",
        "API key can now be saved directly from the portal",
        "Added first-launch welcome dialog",
        "Improved author portal integration",
      ],
    },
  },
];

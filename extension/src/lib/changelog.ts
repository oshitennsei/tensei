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

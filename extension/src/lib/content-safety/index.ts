// Hard limits for Phase 1 — client-side keyword blocking only.
// Phase 3: LLM-based moderation added via checkInputLLM.

// Japanese CJK terms need no \b boundary (CJK chars are not \w in JS regex)
const BLOCKED_PATTERNS = [
  /(爆発物|爆弾|武器製造|麻薬|覚醒剤|児童ポルノ|child\s*porn|\bbomb\s*mak)/i,
];

export interface SafetyResult {
  safe: boolean;
  reason?: string;
}

export function checkInput(text: string): SafetyResult {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: "blocked_content" };
    }
  }
  return { safe: true };
}

export function checkOutput(text: string): SafetyResult {
  return checkInput(text);
}

// Hard turn limits per session (§ hard limits)
export const HARD_LIMITS = {
  max_turns_per_session: 200,
  max_input_chars: 2000,
  max_output_chars: 4000,
} as const;

export function exceedsInputLimit(text: string): boolean {
  return text.length > HARD_LIMITS.max_input_chars;
}

// Phase 3: LLM-based moderation (async, optional — fails open on error)
import type { LlmClient } from "@/lib/llm";

export async function checkInputLLM(text: string, client: LlmClient): Promise<SafetyResult> {
  try {
    const result = await client.complete([
      {
        role: "system",
        content:
          "あなたはコンテンツモデレーターです。ユーザーの入力が有害か判定してください。\n" +
          "有害な内容: 実際の暴力行為の促進、違法薬物の製造・入手方法、児童の性的搾取、実在人物への危害予告。\n" +
          "有害でない内容: フィクションの暴力描写、ロールプレイ、成人向け示唆（露骨でない）、キャラクターとの会話。\n" +
          "判定結果のみ返してください: 「SAFE」または「UNSAFE: 理由」",
      },
      { role: "user", content: text },
    ]);
    const trimmed = result.trim();
    if (trimmed.startsWith("UNSAFE")) {
      return { safe: false, reason: trimmed.slice(8).trim() || "llm_moderation" };
    }
    return { safe: true };
  } catch {
    return { safe: true }; // fail open: if moderation LLM errors, allow the message
  }
}

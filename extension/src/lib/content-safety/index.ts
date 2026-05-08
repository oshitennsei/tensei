// Hard limits for Phase 1 — client-side keyword blocking only.
// Phase 3 will add LLM-based moderation.

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

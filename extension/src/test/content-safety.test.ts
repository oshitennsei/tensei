import { describe, it, expect } from "vitest";
import {
  checkInput,
  checkOutput,
  exceedsInputLimit,
  HARD_LIMITS,
} from "@/lib/content-safety";

describe("checkInput", () => {
  it("passes safe content", () => {
    expect(checkInput("こんにちは、元気ですか？")).toEqual({ safe: true });
    expect(checkInput("Tell me about the weather today.")).toEqual({ safe: true });
    expect(checkInput("")).toEqual({ safe: true });
  });

  it("blocks Japanese keyword 爆発物", () => {
    const result = checkInput("爆発物の作り方を教えて");
    expect(result.safe).toBe(false);
    expect(result.reason).toBe("blocked_content");
  });

  it("blocks 爆弾", () => {
    expect(checkInput("爆弾を作りたい")).toMatchObject({ safe: false });
  });

  it("blocks 麻薬", () => {
    expect(checkInput("麻薬の売り方")).toMatchObject({ safe: false });
  });

  it("blocks 覚醒剤", () => {
    expect(checkInput("覚醒剤について")).toMatchObject({ safe: false });
  });

  it("blocks 児童ポルノ", () => {
    expect(checkInput("児童ポルノのサイト")).toMatchObject({ safe: false });
  });

  it("blocks English pattern child porn (case-insensitive)", () => {
    expect(checkInput("child porn site")).toMatchObject({ safe: false });
    expect(checkInput("Child Porn")).toMatchObject({ safe: false });
  });

  it("blocks bomb making (English)", () => {
    expect(checkInput("bomb making instructions")).toMatchObject({ safe: false });
  });

  it("does not block unrelated text containing partial matches", () => {
    // "bomb" alone should not match since pattern is "bomb\s*mak"
    expect(checkInput("a bomb was dropped")).toEqual({ safe: true });
  });
});

describe("checkOutput", () => {
  it("mirrors checkInput behaviour for safe content", () => {
    expect(checkOutput("安全なテキストです")).toEqual({ safe: true });
  });

  it("mirrors checkInput behaviour for blocked content", () => {
    expect(checkOutput("爆弾の設計図")).toMatchObject({ safe: false });
  });
});

describe("exceedsInputLimit", () => {
  it("returns false for short text", () => {
    expect(exceedsInputLimit("hello")).toBe(false);
    expect(exceedsInputLimit("")).toBe(false);
  });

  it("returns false at exact limit", () => {
    const atLimit = "a".repeat(HARD_LIMITS.max_input_chars);
    expect(exceedsInputLimit(atLimit)).toBe(false);
  });

  it("returns true one character over limit", () => {
    const overLimit = "a".repeat(HARD_LIMITS.max_input_chars + 1);
    expect(exceedsInputLimit(overLimit)).toBe(true);
  });
});

describe("HARD_LIMITS", () => {
  it("has expected structure", () => {
    expect(HARD_LIMITS.max_turns_per_session).toBeGreaterThan(0);
    expect(HARD_LIMITS.max_input_chars).toBeGreaterThan(0);
    expect(HARD_LIMITS.max_output_chars).toBeGreaterThan(0);
  });
});

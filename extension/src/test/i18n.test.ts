import { describe, it, expect } from "vitest";
import { getStrings } from "@/lib/i18n";
import type { UILanguage } from "@/lib/i18n";

const LOCALES: UILanguage[] = ["ja", "zh-tw", "zh-cn", "en"];

describe("i18n locale key consistency", () => {
  it("all locales export the same set of keys as JA", () => {
    const ja = getStrings("ja");
    const jaKeys = Object.keys(ja).sort();

    for (const locale of LOCALES) {
      const strings = getStrings(locale);
      const keys = Object.keys(strings).sort();
      expect(keys, `locale "${locale}" key count mismatch`).toEqual(jaKeys);
    }
  });

  it("all locales have no null or undefined values", () => {
    for (const locale of LOCALES) {
      const strings = getStrings(locale);
      for (const [key, value] of Object.entries(strings)) {
        expect(value, `locale "${locale}" key "${key}" is null/undefined`).not.toBeNull();
        expect(value, `locale "${locale}" key "${key}" is null/undefined`).not.toBeUndefined();
      }
    }
  });

  it("all locales have string or function values (no empty objects)", () => {
    for (const locale of LOCALES) {
      const strings = getStrings(locale);
      for (const [key, value] of Object.entries(strings)) {
        const t = typeof value;
        expect(
          t === "string" || t === "function",
          `locale "${locale}" key "${key}" has unexpected type "${t}"`
        ).toBe(true);
      }
    }
  });

  it("string values are non-empty in all locales", () => {
    for (const locale of LOCALES) {
      const strings = getStrings(locale);
      for (const [key, value] of Object.entries(strings)) {
        if (typeof value === "string") {
          expect(value.length, `locale "${locale}" key "${key}" is empty string`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("function-typed keys have the same arity across all locales", () => {
    const ja = getStrings("ja");
    for (const locale of LOCALES) {
      if (locale === "ja") continue;
      const strings = getStrings(locale);
      for (const [key, value] of Object.entries(ja)) {
        if (typeof value === "function") {
          const localeFn = (strings as Record<string, unknown>)[key];
          expect(typeof localeFn, `locale "${locale}" key "${key}" should be function`).toBe("function");
          expect(
            (localeFn as (...a: unknown[]) => unknown).length,
            `locale "${locale}" key "${key}" arity mismatch`
          ).toBe(value.length);
        }
      }
    }
  });
});

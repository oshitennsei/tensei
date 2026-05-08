import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/storage";
import { getPersonaForWork, buildReaderPersonaText } from "@/lib/persona";
import type { Persona } from "@/lib/storage";

async function clearDb() {
  await db.personas.clear();
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: crypto.randomUUID(),
    name: "テストペルソナ",
    language: "ja",
    content_md: "",
    applies_to: ["*"],
    is_default: false,
    ...overrides,
  };
}

describe("getPersonaForWork", () => {
  beforeEach(clearDb);

  it("returns null when no personas exist", async () => {
    const result = await getPersonaForWork("work-001");
    expect(result).toBeNull();
  });

  it("returns the default persona when applies_to is wildcard", async () => {
    const p = makePersona({ is_default: true, applies_to: ["*"] });
    await db.personas.add(p);
    const result = await getPersonaForWork("any-work-id");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(p.id);
  });

  it("matches persona whose applies_to includes a substring of work_id", async () => {
    const p = makePersona({ applies_to: ["fantasy"], name: "ファンタジー向け" });
    await db.personas.add(p);
    const result = await getPersonaForWork("work-fantasy-001");
    expect(result!.name).toBe("ファンタジー向け");
  });

  it("returns default persona when no applies_to matches", async () => {
    const specific = makePersona({ applies_to: ["sci-fi"], name: "SF向け" });
    const defaultP = makePersona({ applies_to: ["*"], is_default: true, name: "デフォルト" });
    await db.personas.bulkAdd([specific, defaultP]);
    const result = await getPersonaForWork("work-romance-001");
    expect(result!.name).toBe("デフォルト");
  });

  it("prefers matched persona over default", async () => {
    const matched = makePersona({ applies_to: ["romance"], name: "ロマンス向け" });
    const defaultP = makePersona({ applies_to: ["*"], is_default: true, name: "デフォルト" });
    await db.personas.bulkAdd([matched, defaultP]);
    const result = await getPersonaForWork("work-romance-001");
    expect(result!.name).toBe("ロマンス向け");
  });
});

describe("buildReaderPersonaText", () => {
  beforeEach(clearDb);

  it("returns empty string when no persona exists", async () => {
    const text = await buildReaderPersonaText("work-no-persona");
    expect(text).toBe("");
  });

  it("includes language instruction for zh-tw", async () => {
    const p = makePersona({ language: "zh-tw", applies_to: ["*"], is_default: true });
    await db.personas.add(p);
    const text = await buildReaderPersonaText("work-001");
    expect(text).toContain("繁體中文");
    expect(text).toContain("繁體中文で返答してください");
  });

  it("includes language instruction for en", async () => {
    const p = makePersona({ language: "en", applies_to: ["*"], is_default: true });
    await db.personas.add(p);
    const text = await buildReaderPersonaText("work-001");
    expect(text).toContain("English");
  });

  it("includes content_md in output", async () => {
    const p = makePersona({
      language: "ja",
      applies_to: ["*"],
      is_default: true,
      content_md: "読者は高校生です。",
    });
    await db.personas.add(p);
    const text = await buildReaderPersonaText("work-001");
    expect(text).toContain("読者は高校生です。");
    expect(text).toContain("読者について");
  });

  it("skips content_md section when empty", async () => {
    const p = makePersona({ language: "ja", applies_to: ["*"], is_default: true, content_md: "   " });
    await db.personas.add(p);
    const text = await buildReaderPersonaText("work-001");
    expect(text).not.toContain("読者について");
  });

  it("returns empty string for language 'ja' (no label mapping)", async () => {
    // "ja" is not in LANGUAGE_LABELS, so no language instruction is added
    const p = makePersona({ language: "ja", applies_to: ["*"], is_default: true, content_md: "" });
    await db.personas.add(p);
    const text = await buildReaderPersonaText("work-001");
    expect(text).toBe("");
  });
});

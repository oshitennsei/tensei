import { db } from "@/lib/storage";
import type { Persona, Language } from "@/lib/storage";

const LANGUAGE_LABELS: Partial<Record<Language, string>> = {
  "zh-tw": "繁體中文",
  "zh-cn": "简体中文",
  "zh":    "中文",
  "en":    "English",
  "ko":    "한국어",
};

export async function getPersonaForWork(work_id: string): Promise<Persona | null> {
  const all = await db.personas.toArray();
  // Specific patterns take priority over wildcard "*"
  const specific = all.find(p =>
    p.applies_to.some(pattern => pattern !== "*" && work_id.includes(pattern))
  );
  if (specific) return specific;
  const wildcard = all.find(p => p.applies_to.includes("*"));
  if (wildcard) return wildcard;
  const defaultP = await db.personas.where("is_default").equals(1 as never).first();
  return defaultP ?? null;
}

export async function buildReaderPersonaText(work_id: string): Promise<string> {
  const persona = await getPersonaForWork(work_id);
  if (!persona) return "";

  const parts: string[] = [];

  const langLabel = LANGUAGE_LABELS[persona.language];
  if (langLabel) {
    parts.push(
      `読者の希望言語: ${langLabel}\n` +
      `必ず${langLabel}で返答してください。` +
      `固有名詞（人名・地名・道具名）はなるべく原語を保持してください。`
    );
  }

  if (persona.content_md.trim()) {
    parts.push(`## 読者について\n${persona.content_md}`);
  }

  return parts.join("\n\n");
}

export async function savePersona(data: Omit<Persona, "id">): Promise<string> {
  const id = crypto.randomUUID();
  if (data.is_default) {
    await db.personas.where("is_default").equals(1 as never).modify({ is_default: false });
  }
  await db.personas.add({ ...data, id });
  return id;
}

export async function updatePersona(id: string, data: Partial<Omit<Persona, "id">>): Promise<void> {
  if (data.is_default) {
    await db.personas.where("is_default").equals(1 as never).modify({ is_default: false });
  }
  await db.personas.update(id, data);
}

export async function listPersonas(): Promise<Persona[]> {
  return db.personas.toArray();
}

export async function deletePersona(id: string): Promise<void> {
  await db.personas.delete(id);
}

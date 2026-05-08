import { db } from "@/lib/storage";
import defaultBgPng from "@/assets/default-bg.png";

export const DEFAULT_BG = `url(${defaultBgPng}) center/cover no-repeat`;

export const GRADIENT_PRESETS: { label: string; value: string }[] = [
  { label: "深夜書房", value: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" },
  { label: "黎明前", value: "linear-gradient(135deg, #2d1b69 0%, #11998e 100%)" },
  { label: "月明廊", value: "linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)" },
  { label: "楓葉秋", value: "linear-gradient(135deg, #3d1a00 0%, #6b2d0e 50%, #4a1504 100%)" },
];

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1440;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error("画像の圧縮に失敗しました")),
        "image/jpeg",
        0.82,
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Returns a CSS `background` value (data URL, gradient, or color string)
export async function getEffectiveBackground(work_id?: string): Promise<string> {
  if (work_id) {
    const work = await db.works.get(work_id);
    if (work?.background_image) return `url(${await blobToDataUrl(work.background_image)}) center/cover no-repeat`;
    if (work?.background_value) return work.background_value;
  }
  const settings = await db.app_settings.get("global");
  if (settings?.background_image) return `url(${await blobToDataUrl(settings.background_image)}) center/cover no-repeat`;
  if (settings?.background_value) return settings.background_value;
  return DEFAULT_BG;
}

// ── Global background ─────────────────────────────────────────────────────────

export async function setGlobalBackground(file: File): Promise<void> {
  const compressed = await compressImage(file);
  const cur = await db.app_settings.get("global");
  await db.app_settings.put({ ...(cur ?? {}), id: "global", background_image: compressed, background_value: undefined });
}

export async function setGlobalBackgroundValue(value: string): Promise<void> {
  const cur = await db.app_settings.get("global");
  await db.app_settings.put({ ...(cur ?? {}), id: "global", background_image: undefined, background_value: value });
}

export async function clearGlobalBackground(): Promise<void> {
  await db.app_settings.put({ id: "global" });
}

export async function getGlobalBackgroundState(): Promise<{ image: string | null; value: string | null }> {
  const settings = await db.app_settings.get("global");
  return {
    image: settings?.background_image ? await blobToDataUrl(settings.background_image) : null,
    value: settings?.background_value ?? null,
  };
}

// ── Work background ───────────────────────────────────────────────────────────

export async function setWorkBackground(work_id: string, file: File): Promise<void> {
  const compressed = await compressImage(file);
  await db.works.update(work_id, { background_image: compressed, background_value: undefined });
}

export async function setWorkBackgroundValue(work_id: string, value: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.works.update(work_id, { background_image: null as any, background_value: value });
}

export async function clearWorkBackground(work_id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.works.update(work_id, { background_image: null as any, background_value: undefined });
}

export async function getWorkBackgroundState(work_id: string): Promise<{ image: string | null; value: string | null }> {
  const work = await db.works.get(work_id);
  return {
    image: work?.background_image ? await blobToDataUrl(work.background_image) : null,
    value: work?.background_value ?? null,
  };
}

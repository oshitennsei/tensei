import { LlmClient, getModelForRole } from "@/lib/llm";

export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export async function getEmbedder(): Promise<EmbedFn | null> {
  const model = await getModelForRole("embedding");
  if (!model) return null;

  if (model.endpoint_url.startsWith("local://")) {
    const { localEmbed } = await import("./local");
    return (texts) => localEmbed(texts, model.model_name);
  }

  const client = new LlmClient(model);
  return (texts) => client.embed(texts);
}

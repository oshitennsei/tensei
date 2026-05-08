import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExtractorPipeline = any;

let _extractor: ExtractorPipeline | null = null;
let _model: string | null = null;

export async function localEmbed(texts: string[], model: string): Promise<Float32Array[]> {
  if (!_extractor || _model !== model) {
    _extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
    _model = model;
  }

  const results: Float32Array[] = [];
  for (const text of texts) {
    const out = await _extractor(text, { pooling: "mean", normalize: true });
    results.push(new Float32Array(out.data as ArrayBufferLike));
  }
  return results;
}

// Embeddings pipeline via Lovable AI Gateway.
// Input: array of short strings (memory node summaries, incident titles etc.).
// Output: array of Float64 vectors suitable for pgvector (length normalized
// to 1536 to match existing vector(1536) columns).
//
// Falls back gracefully when LOVABLE_API_KEY is not set — returns null, and
// callers keep using the pre-embedding code path (ilike, char-hash).
//
// Default model is openai/text-embedding-3-small (1536 dims native). Override
// via EMBEDDINGS_MODEL env. Because different models return different dims,
// we always normalize (pad or truncate) to EMBEDDING_DIM so the DB schema
// doesn't have to change when we swap models.

const LOVABLE_EMBEDDINGS_URL =
  "https://ai.gateway.lovable.dev/v1/embeddings";
const DEFAULT_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536; // matches vector(1536) columns

export interface EmbedOptions {
  model?: string;
  dimensions?: number;
}

export interface EmbedBatchResult {
  vectors: number[][];
  model: string;
  inputTokens?: number;
}

/**
 * Generate embeddings for a batch of strings. Returns null if the gateway
 * key isn't configured so callers can degrade gracefully.
 */
export async function embedBatch(
  inputs: string[],
  opts: EmbedOptions = {},
): Promise<EmbedBatchResult | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  if (!inputs.length) return { vectors: [], model: opts.model ?? DEFAULT_MODEL };

  const model = opts.model ?? Deno.env.get("EMBEDDINGS_MODEL") ?? DEFAULT_MODEL;
  const resp = await fetch(LOVABLE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: inputs,
      // Only pass `dimensions` when the caller explicitly sets it. Some models
      // (e.g. google/text-embedding-004) reject that param. Defaults to the
      // model's native dimension; we normalize post-hoc.
      ...(opts.dimensions ? { dimensions: opts.dimensions } : {}),
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`embeddings gateway ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const json = await resp.json();
  const raw = (json.data ?? []).map((d: any) => d.embedding as number[]);
  const target = opts.dimensions ?? EMBEDDING_DIM;
  const vectors = raw.map((v: number[]) => normalizeDim(v, target));
  return {
    vectors,
    model,
    inputTokens: json.usage?.prompt_tokens,
  };
}

/**
 * Normalize a vector to `targetDim` by either truncating (if longer) or
 * zero-padding (if shorter). Keeps cosine similarity meaningful across
 * model swaps when we have existing nodes in the DB.
 */
function normalizeDim(v: number[], targetDim: number): number[] {
  if (v.length === targetDim) return v;
  if (v.length > targetDim) return v.slice(0, targetDim);
  const padded = new Array(targetDim).fill(0);
  for (let i = 0; i < v.length; i++) padded[i] = v[i];
  return padded;
}

/**
 * Convenience: embed a single string. Returns null if no key.
 */
export async function embedOne(input: string, opts: EmbedOptions = {}): Promise<number[] | null> {
  const r = await embedBatch([input], opts);
  if (!r || !r.vectors.length) return null;
  return r.vectors[0];
}

/**
 * Format a float array as a pgvector literal: "[0.1,0.2,...]".
 */
export function toPgVector(v: number[]): string {
  return "[" + v.join(",") + "]";
}

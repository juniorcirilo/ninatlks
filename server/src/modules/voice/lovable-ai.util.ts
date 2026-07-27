const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Shared batch (non-streaming) Lovable AI Gateway caller — used by the
 * sentiment/classification/summary/reclassify post-call functions, all of
 * which called this exact endpoint independently in the original Deno code.
 * Returns null (never throws) on missing key, non-OK response, or empty
 * content — every caller has its own heuristic/lexicon fallback for exactly
 * that reason, matching the originals.
 */
export async function lovableChatCompletion(params: {
  model: string;
  messages: ChatMessage[];
  jsonMode?: boolean;
  maxTokens?: number;
}): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.jsonMode
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

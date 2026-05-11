// Deepgram batch transcription client.
// Reference: https://developers.deepgram.com/reference/listen-remote
//
// We send the signed Supabase URL; Deepgram fetches it itself, so we never
// stream large audio through the edge function.

export interface DeepgramTranscript {
  transcriptText: string;
  utterances: Array<{
    speaker: number;
    start: number;
    end: number;
    transcript: string;
    confidence: number;
  }>;
  language?: string;
  durationSec?: number;
  raw: any;
}

export interface DeepgramOptions {
  model?: string;                       // default "nova-3" / "nova-2" when pt-BR
  language?: string;                    // "pt" | "en" | etc.
  diarize?: boolean;
  punctuate?: boolean;
  smartFormat?: boolean;
  utterances?: boolean;
}

export async function transcribeRemote(params: {
  apiKey: string;
  audioUrl: string;
  options?: DeepgramOptions;
}): Promise<DeepgramTranscript> {
  const { apiKey, audioUrl, options = {} } = params;
  const qs = new URLSearchParams();
  qs.set("model", options.model ?? "nova-3");
  qs.set("language", options.language ?? "pt");
  qs.set("diarize", String(options.diarize ?? true));
  qs.set("punctuate", String(options.punctuate ?? true));
  qs.set("smart_format", String(options.smartFormat ?? true));
  qs.set("utterances", String(options.utterances ?? true));

  const res = await fetch(`https://api.deepgram.com/v1/listen?${qs.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Deepgram ${res.status}: ${msg}`);
  }
  const j = await res.json();

  const alt = j.results?.channels?.[0]?.alternatives?.[0];
  const transcriptText = alt?.transcript ?? "";
  const utts = (j.results?.utterances ?? []).map((u: any) => ({
    speaker: u.speaker ?? 0,
    start: u.start,
    end: u.end,
    transcript: u.transcript,
    confidence: u.confidence,
  }));

  return {
    transcriptText,
    utterances: utts,
    language: alt?.language,
    durationSec: j.metadata?.duration,
    raw: j,
  };
}

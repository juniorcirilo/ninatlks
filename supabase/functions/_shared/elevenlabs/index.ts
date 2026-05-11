// Barrel for ElevenLabs helpers used by edge functions.

export { elevenRequest, ElevenLabsError, resolveCredentials, resolveCredentialsForAccount } from "./client.ts";
export type { ElevenLabsCredentials, ElevenRequest } from "./client.ts";

export * as voices from "./voices.ts";
export type { Voice, VoiceSettings } from "./voices.ts";
export { DEFAULT_VOICE_SETTINGS } from "./voices.ts";

export * as tts from "./tts.ts";
export type { OutputFormat, SynthOptions } from "./tts.ts";

export * as usage from "./usage.ts";
export type { SubscriptionInfo } from "./usage.ts";
export { quotaFraction } from "./usage.ts";

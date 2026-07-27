// User / subscription / usage stats — used to show quota + alert when near limit.
// Reference: https://elevenlabs.io/docs/api-reference/user/get-subscription

import { elevenRequest, type ElevenLabsCredentials } from "./client.ts";

export interface SubscriptionInfo {
  tier: string;
  character_count: number;          // used this period
  character_limit: number;          // plan cap
  can_extend_character_limit: boolean;
  allowed_to_extend_character_limit: boolean;
  next_character_count_reset_unix: number;
  voice_limit: number;              // number of custom voices allowed
  voice_slots_used?: number;
  professional_voice_limit?: number;
  can_extend_voice_limit?: boolean;
  can_use_instant_voice_cloning?: boolean;
  can_use_professional_voice_cloning?: boolean;
  status: string;
}

export async function getSubscription(
  creds: ElevenLabsCredentials,
): Promise<SubscriptionInfo> {
  return elevenRequest<SubscriptionInfo>({
    method: "GET",
    path: "/v1/user/subscription",
    credentials: creds,
  });
}

/**
 * Character usage breakdown — last 30 days by voice or by model.
 * Used by /platform-health to show cost + trends.
 */
export async function getUsageStats(
  creds: ElevenLabsCredentials,
  opts: {
    startUnix: number;
    endUnix: number;
    breakdown?: "voice" | "model" | "request_source";
  },
): Promise<any> {
  return elevenRequest({
    method: "GET",
    path: "/v1/usage/character-stats",
    credentials: creds,
    query: {
      start_unix: opts.startUnix,
      end_unix: opts.endUnix,
      breakdown_type: opts.breakdown,
    },
  });
}

/**
 * Percentage of monthly char quota consumed (0..1). Handy for alerts.
 */
export function quotaFraction(sub: SubscriptionInfo): number {
  if (!sub.character_limit || sub.character_limit < 1) return 0;
  return sub.character_count / sub.character_limit;
}

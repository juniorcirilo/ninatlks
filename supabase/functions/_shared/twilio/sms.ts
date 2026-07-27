// Twilio Programmable Messaging — SMS + MMS senders.
// Reference: https://www.twilio.com/docs/messaging/api/message-resource

import { twilioRequest, toE164 } from "./client.ts";
import type { TwilioChannelConfig } from "./config.ts";

export interface SendSmsInput {
  to: string;
  body?: string;
  mediaUrls?: string[];
  statusCallback?: string;
  smartEncoded?: boolean;
}

export interface SmsResult {
  sid: string;
  status: string;
  segments?: number;
  errorCode?: number | null;
  raw: any;
}

/**
 * Send an SMS (or MMS when mediaUrls is provided).
 * Must pass either a Messaging Service SID or an E.164 `From` number — we
 * prefer Messaging Service when configured (handles opt-outs + deliverability).
 */
export async function sendSms(
  cfg: TwilioChannelConfig,
  args: SendSmsInput,
): Promise<SmsResult> {
  const form: Record<string, any> = {
    To: toE164(args.to),
  };
  if (args.body) form.Body = args.body;
  if (args.mediaUrls?.length) form.MediaUrl = args.mediaUrls;
  if (args.statusCallback) form.StatusCallback = args.statusCallback;
  if (args.smartEncoded) form.SmartEncoded = "true";

  if (cfg.messagingServiceSid) {
    form.MessagingServiceSid = cfg.messagingServiceSid;
  } else if (cfg.e164) {
    form.From = cfg.e164;
  } else {
    throw new Error("SMS channel needs either messaging_service_sid or from_number");
  }

  const resp = await twilioRequest<any>({
    method: "POST",
    path: `/2010-04-01/Accounts/${cfg.credentials.accountSid}/Messages.json`,
    credentials: cfg.credentials,
    form,
  });

  return {
    sid: resp.sid,
    status: resp.status,
    segments: resp.num_segments ? parseInt(resp.num_segments, 10) : undefined,
    errorCode: resp.error_code ?? null,
    raw: resp,
  };
}

/** Stop keywords per Twilio best practice + PT-BR variants. */
const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "PARAR",
  "CANCELAR",
  "SAIR",
  "DESCADASTRAR",
]);

const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP", "INICIAR", "RETOMAR"]);

export function classifyOptKeyword(body: string | null | undefined): "opt_out" | "opt_in" | null {
  if (!body) return null;
  const first = body.trim().toUpperCase().split(/\s+/)[0] ?? "";
  if (OPT_OUT_KEYWORDS.has(first)) return "opt_out";
  if (OPT_IN_KEYWORDS.has(first)) return "opt_in";
  return null;
}

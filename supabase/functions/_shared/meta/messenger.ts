// Facebook Messenger outbound helpers.
// Reference: https://developers.facebook.com/docs/messenger-platform/reference/send-api

import { graphRequest } from "./client.ts";

export interface MessengerConfig {
  channelId: string;
  accountId: string;
  pageId: string;
  accessToken: string;
}

export interface MessengerSendResult {
  providerMessageId?: string;
  raw: any;
}

async function postPageMessages(
  cfg: MessengerConfig,
  recipient: Record<string, any>,
  message: Record<string, any>,
  messagingType: string = "RESPONSE",
  tag?: string,
): Promise<MessengerSendResult> {
  const body: Record<string, any> = {
    recipient,
    messaging_type: messagingType,
    message,
  };
  if (tag) body.tag = tag;
  const r = await graphRequest({
    method: "POST",
    path: `/${cfg.pageId}/messages`,
    accessToken: cfg.accessToken,
    body,
  });
  return { providerMessageId: r.data?.message_id, raw: r.data };
}

export function sendText(
  cfg: MessengerConfig,
  args: { psid: string; text: string; messagingType?: string; tag?: string },
) {
  return postPageMessages(
    cfg,
    { id: args.psid },
    { text: args.text },
    args.messagingType ?? "RESPONSE",
    args.tag,
  );
}

export function sendAttachment(
  cfg: MessengerConfig,
  args: { psid: string; type: "image" | "audio" | "video" | "file"; url: string },
) {
  return postPageMessages(cfg, { id: args.psid }, {
    attachment: { type: args.type, payload: { url: args.url } },
  });
}

export function sendQuickReplies(
  cfg: MessengerConfig,
  args: {
    psid: string;
    text: string;
    quickReplies: Array<{ title: string; payload: string; imageUrl?: string }>;
  },
) {
  return postPageMessages(cfg, { id: args.psid }, {
    text: args.text,
    quick_replies: args.quickReplies.map((q) => ({
      content_type: "text",
      title: q.title,
      payload: q.payload,
      image_url: q.imageUrl,
    })),
  });
}

export function sendGenericTemplate(
  cfg: MessengerConfig,
  args: { psid: string; elements: any[] },
) {
  return postPageMessages(cfg, { id: args.psid }, {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: args.elements },
    },
  });
}

export function senderAction(
  cfg: MessengerConfig,
  args: { psid: string; action: "mark_seen" | "typing_on" | "typing_off" },
) {
  return graphRequest({
    method: "POST",
    path: `/${cfg.pageId}/messages`,
    accessToken: cfg.accessToken,
    body: { recipient: { id: args.psid }, sender_action: args.action },
  });
}

export async function fetchUserProfile(
  cfg: MessengerConfig,
  psid: string,
  fields = "first_name,last_name,profile_pic,locale",
) {
  const r = await graphRequest({
    method: "GET",
    path: `/${psid}`,
    accessToken: cfg.accessToken,
    query: { fields },
  });
  return r.data;
}

// Instagram Messaging (via Messenger Platform) — outbound helpers.

import { graphRequest } from "./client.ts";
import type { InstagramConfig } from "./config.ts";

export interface IgSendResult {
  providerMessageId?: string;
  raw: any;
}

async function postMeMessages(
  cfg: InstagramConfig,
  recipient: Record<string, any>,
  message: Record<string, any>,
): Promise<IgSendResult> {
  const r = await graphRequest({
    method: "POST",
    path: `/me/messages`,
    accessToken: cfg.accessToken,
    body: { recipient, message },
  });
  return { providerMessageId: r.data?.message_id, raw: r.data };
}

export function sendText(cfg: InstagramConfig, args: { igsid: string; text: string }) {
  return postMeMessages(cfg, { id: args.igsid }, { text: args.text });
}

export function sendQuickReplies(
  cfg: InstagramConfig,
  args: {
    igsid: string;
    text: string;
    quickReplies: Array<{ title: string; payload: string; imageUrl?: string }>;
  },
) {
  return postMeMessages(cfg, { id: args.igsid }, {
    text: args.text,
    quick_replies: args.quickReplies.map((q) => ({
      content_type: "text",
      title: q.title,
      payload: q.payload,
      image_url: q.imageUrl,
    })),
  });
}

export function sendAttachment(
  cfg: InstagramConfig,
  args: { igsid: string; type: "image" | "audio" | "video" | "file"; url: string },
) {
  return postMeMessages(cfg, { id: args.igsid }, {
    attachment: { type: args.type, payload: { url: args.url } },
  });
}

export function sendGenericTemplate(
  cfg: InstagramConfig,
  args: { igsid: string; elements: any[] },
) {
  return postMeMessages(cfg, { id: args.igsid }, {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: args.elements },
    },
  });
}

export function sendButtonTemplate(
  cfg: InstagramConfig,
  args: { igsid: string; text: string; buttons: any[] },
) {
  return postMeMessages(cfg, { id: args.igsid }, {
    attachment: {
      type: "template",
      payload: { template_type: "button", text: args.text, buttons: args.buttons },
    },
  });
}

export function privateReplyToComment(
  cfg: InstagramConfig,
  args: { commentId: string; text: string },
) {
  return postMeMessages(cfg, { comment_id: args.commentId }, { text: args.text });
}

export async function fetchProfile(
  cfg: InstagramConfig,
  igsid: string,
  fields = "name,username,profile_pic",
) {
  const r = await graphRequest({
    method: "GET",
    path: `/${igsid}`,
    accessToken: cfg.accessToken,
    query: { fields },
  });
  return r.data;
}

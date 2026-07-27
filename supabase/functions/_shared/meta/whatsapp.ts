// WhatsApp Cloud API — outbound message builders + template/media endpoints.
// All callers pass a resolved WhatsAppConfig; this module knows nothing
// about RLS or tenant isolation — that's the caller's job.

import { graphRequest } from "./client.ts";
import type { WhatsAppConfig } from "./config.ts";

export type WhatsAppMessageKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "reaction"
  | "template"
  | "interactive_reply_buttons"
  | "interactive_list"
  | "interactive_cta_url"
  | "interactive_flow"
  | "address";

export interface SendResult {
  providerMessageId?: string;
  contactWaId?: string;
  raw: any;
}

function normalizeTo(to: string): string {
  return to.replace(/^\+/, "").trim();
}

async function postMessage(cfg: WhatsAppConfig, body: Record<string, any>): Promise<SendResult> {
  const payload: Record<string, any> = {
    messaging_product: "whatsapp",
    recipient_type: body.recipient_type ?? "individual",
    ...body,
  };
  if (payload.to) payload.to = normalizeTo(payload.to);
  const r = await graphRequest({
    method: "POST",
    path: `/${cfg.phoneNumberId}/messages`,
    accessToken: cfg.accessToken,
    body: payload,
  });
  const msg = r.data?.messages?.[0];
  const contact = r.data?.contacts?.[0];
  return {
    providerMessageId: msg?.id,
    contactWaId: contact?.wa_id,
    raw: r.data,
  };
}

// ─────────────────────────────────────────────────────────────
// Individual senders
// ─────────────────────────────────────────────────────────────

export function sendText(
  cfg: WhatsAppConfig,
  args: { to: string; body: string; previewUrl?: boolean; replyToMessageId?: string },
) {
  const body: Record<string, any> = {
    to: args.to,
    type: "text",
    text: { preview_url: args.previewUrl ?? true, body: args.body },
  };
  if (args.replyToMessageId) body.context = { message_id: args.replyToMessageId };
  return postMessage(cfg, body);
}

export function sendMedia(
  cfg: WhatsAppConfig,
  args: {
    to: string;
    kind: "image" | "audio" | "video" | "document" | "sticker";
    mediaId?: string;
    link?: string;
    caption?: string;
    filename?: string;
  },
) {
  if (!args.mediaId && !args.link) {
    throw new Error("mediaId or link required");
  }
  const payload: Record<string, any> = {};
  if (args.mediaId) payload.id = args.mediaId;
  if (args.link) payload.link = args.link;
  if (args.caption && ["image", "video", "document"].includes(args.kind)) payload.caption = args.caption;
  if (args.filename && args.kind === "document") payload.filename = args.filename;
  return postMessage(cfg, { to: args.to, type: args.kind, [args.kind]: payload });
}

export function sendLocation(
  cfg: WhatsAppConfig,
  args: { to: string; latitude: number; longitude: number; name?: string; address?: string },
) {
  return postMessage(cfg, {
    to: args.to,
    type: "location",
    location: {
      latitude: args.latitude,
      longitude: args.longitude,
      name: args.name,
      address: args.address,
    },
  });
}

export function sendContacts(
  cfg: WhatsAppConfig,
  args: { to: string; contacts: any[] },
) {
  return postMessage(cfg, { to: args.to, type: "contacts", contacts: args.contacts });
}

export function sendReaction(
  cfg: WhatsAppConfig,
  args: { to: string; messageId: string; emoji: string },
) {
  return postMessage(cfg, {
    to: args.to,
    type: "reaction",
    reaction: { message_id: args.messageId, emoji: args.emoji },
  });
}

export function sendTemplate(
  cfg: WhatsAppConfig,
  args: { to: string; name: string; language: string; components?: any[] },
) {
  return postMessage(cfg, {
    to: args.to,
    type: "template",
    template: {
      name: args.name,
      language: { code: args.language },
      components: args.components ?? [],
    },
  });
}

export function sendReplyButtons(
  cfg: WhatsAppConfig,
  args: {
    to: string;
    body: string;
    buttons: Array<{ id: string; title: string }>;
    header?: { type: "text"; text: string } | { type: "image"; image: { link: string } };
    footer?: string;
  },
) {
  const interactive: Record<string, any> = {
    type: "button",
    body: { text: args.body },
    action: {
      buttons: args.buttons.map((b) => ({ type: "reply", reply: b })),
    },
  };
  if (args.header) interactive.header = args.header;
  if (args.footer) interactive.footer = { text: args.footer };
  return postMessage(cfg, { to: args.to, type: "interactive", interactive });
}

export function sendList(
  cfg: WhatsAppConfig,
  args: {
    to: string;
    body: string;
    buttonText: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    headerText?: string;
    footerText?: string;
  },
) {
  const interactive: Record<string, any> = {
    type: "list",
    body: { text: args.body },
    action: { button: args.buttonText, sections: args.sections },
  };
  if (args.headerText) interactive.header = { type: "text", text: args.headerText };
  if (args.footerText) interactive.footer = { text: args.footerText };
  return postMessage(cfg, { to: args.to, type: "interactive", interactive });
}

export function sendCtaUrl(
  cfg: WhatsAppConfig,
  args: {
    to: string;
    body: string;
    displayText: string;
    url: string;
    headerText?: string;
    footerText?: string;
  },
) {
  const interactive: Record<string, any> = {
    type: "cta_url",
    body: { text: args.body },
    action: {
      name: "cta_url",
      parameters: { display_text: args.displayText, url: args.url },
    },
  };
  if (args.headerText) interactive.header = { type: "text", text: args.headerText };
  if (args.footerText) interactive.footer = { text: args.footerText };
  return postMessage(cfg, { to: args.to, type: "interactive", interactive });
}

export function sendFlow(
  cfg: WhatsAppConfig,
  args: {
    to: string;
    body: string;
    flowId: string;
    flowToken: string;
    flowCta: string;
    flowAction?: "navigate" | "data_exchange";
    screen?: string;
    flowActionPayload?: Record<string, any>;
    headerText?: string;
    footerText?: string;
  },
) {
  const parameters: Record<string, any> = {
    flow_token: args.flowToken,
    flow_id: args.flowId,
    flow_cta: args.flowCta,
    flow_action: args.flowAction ?? "navigate",
  };
  if ((args.flowAction ?? "navigate") === "navigate") {
    parameters.flow_action_payload = {
      screen: args.screen,
      data: args.flowActionPayload ?? {},
    };
  }
  const interactive: Record<string, any> = {
    type: "flow",
    body: { text: args.body },
    action: { name: "flow", parameters },
  };
  if (args.headerText) interactive.header = { type: "text", text: args.headerText };
  if (args.footerText) interactive.footer = { text: args.footerText };
  return postMessage(cfg, { to: args.to, type: "interactive", interactive });
}

// ─────────────────────────────────────────────────────────────
// Read receipts & typing
// ─────────────────────────────────────────────────────────────

export async function markAsRead(
  cfg: WhatsAppConfig,
  args: { messageId: string; typingIndicator?: boolean },
) {
  const body: Record<string, any> = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: args.messageId,
  };
  if (args.typingIndicator) body.typing_indicator = { type: "text" };
  await graphRequest({
    method: "POST",
    path: `/${cfg.phoneNumberId}/messages`,
    accessToken: cfg.accessToken,
    body,
  });
}

// ─────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────

export interface TemplateInput {
  name: string;
  language: string;
  category: "AUTHENTICATION" | "MARKETING" | "UTILITY";
  components: any[];
}

export async function listTemplates(
  cfg: WhatsAppConfig,
  opts: { limit?: number; after?: string; status?: string } = {},
) {
  return graphRequest({
    method: "GET",
    path: `/${cfg.wabaId}/message_templates`,
    accessToken: cfg.accessToken,
    query: { limit: opts.limit ?? 100, after: opts.after, status: opts.status, fields: "name,language,category,status,components,quality_score,rejected_reason,id" },
  });
}

export async function createTemplate(cfg: WhatsAppConfig, input: TemplateInput) {
  return graphRequest({
    method: "POST",
    path: `/${cfg.wabaId}/message_templates`,
    accessToken: cfg.accessToken,
    body: input,
  });
}

export async function deleteTemplateByName(cfg: WhatsAppConfig, name: string) {
  return graphRequest({
    method: "DELETE",
    path: `/${cfg.wabaId}/message_templates`,
    accessToken: cfg.accessToken,
    query: { name },
  });
}

// ─────────────────────────────────────────────────────────────
// Media
// ─────────────────────────────────────────────────────────────

export async function uploadMediaFromBlob(
  cfg: WhatsAppConfig,
  blob: Blob,
  mimeType: string,
  filename = "upload",
): Promise<{ mediaId: string }> {
  const fd = new FormData();
  fd.set("messaging_product", "whatsapp");
  fd.set("type", mimeType);
  fd.set("file", blob, filename);
  const r = await graphRequest({
    method: "POST",
    path: `/${cfg.phoneNumberId}/media`,
    accessToken: cfg.accessToken,
    formData: fd,
  });
  return { mediaId: r.data.id };
}

/**
 * Fetch the short-lived pre-signed URL for a media asset.
 */
export async function getMediaInfo(
  cfg: WhatsAppConfig,
  mediaId: string,
): Promise<{ url: string; mimeType: string; sha256?: string; fileSize?: number }> {
  const r = await graphRequest({
    method: "GET",
    path: `/${mediaId}`,
    accessToken: cfg.accessToken,
    query: { phone_number_id: cfg.phoneNumberId },
  });
  return {
    url: r.data.url,
    mimeType: r.data.mime_type,
    sha256: r.data.sha256,
    fileSize: r.data.file_size,
  };
}

/**
 * Actually download the media bytes (Meta's URL requires Bearer auth).
 */
export async function downloadMedia(cfg: WhatsAppConfig, signedUrl: string): Promise<Blob> {
  const res = await fetch(signedUrl, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!res.ok) throw new Error(`media download failed: ${res.status}`);
  return res.blob();
}

export async function deleteMedia(cfg: WhatsAppConfig, mediaId: string) {
  return graphRequest({
    method: "DELETE",
    path: `/${mediaId}`,
    accessToken: cfg.accessToken,
    query: { phone_number_id: cfg.phoneNumberId },
  });
}

// ─────────────────────────────────────────────────────────────
// Template variable substitution (local — no Graph call)
// ─────────────────────────────────────────────────────────────

/**
 * Build the `components` array for a template send, given the template
 * definition (as stored locally) and a flat map of variable values.
 *
 * Input shape:
 *   components: the template's canonical components array (header/body/buttons)
 *   variables: { "body.1": "João", "header.1": "Fulano", "button.0.url.1": "abc123" }
 *
 * Any missing variable stays as `{{n}}` so Meta rejects it rather than silently
 * sending a broken message.
 */
export function renderTemplateComponents(
  components: any[],
  variables: Record<string, string | number> = {},
): any[] {
  const out: any[] = [];
  for (const comp of components ?? []) {
    const type = String(comp.type ?? "").toLowerCase();
    if (type === "header") {
      const params = extractVars(comp, "header.", variables);
      if (params.length) out.push({ type: "header", parameters: params });
    } else if (type === "body") {
      const params = extractVars(comp, "body.", variables);
      if (params.length) out.push({ type: "body", parameters: params });
    } else if (type === "buttons") {
      const buttons = Array.isArray(comp.buttons) ? comp.buttons : [];
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        if (btn.type === "url") {
          const v = variables[`button.${i}.url`] ?? variables[`button.${i}.url.1`];
          if (v !== undefined) {
            out.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: String(v) }] });
          }
        } else if (btn.type === "quick_reply") {
          const v = variables[`button.${i}.payload`];
          if (v !== undefined) {
            out.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: String(v) }] });
          }
        }
      }
    }
  }
  return out;
}

function extractVars(comp: any, prefix: string, vars: Record<string, string | number>): any[] {
  // Look at the raw text for {{N}} placeholders; their order determines the
  // positional parameters we must send.
  const text: string = comp.text ?? comp.example?.body_text?.[0]?.[0] ?? "";
  const placeholders = Array.from(text.matchAll(/\{\{(\w+)\}\}/g)).map((m) => m[1]);
  if (!placeholders.length) return [];
  return placeholders.map((ph) => {
    const key = `${prefix}${ph}`;
    const value = vars[key] ?? vars[ph] ?? "";
    return { type: "text", text: String(value) };
  });
}

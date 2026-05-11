// Barrel export — single import surface for every caller.
// `import { whatsapp, instagram, media, loadWhatsAppConfig } from "../_shared/meta/index.ts";`

export * as whatsapp from "./whatsapp.ts";
export * as instagram from "./instagram.ts";
export * as messenger from "./messenger.ts";
export * as media from "./media.ts";
export { graphRequest, GraphError, recordUsage, withUsageCapture } from "./client.ts";
export {
  ChannelConfigError,
  findMessengerChannelByPageId,
  findWhatsAppChannelByPhoneId,
  loadInstagramConfig,
  loadMessengerConfig,
  loadWhatsAppConfig,
} from "./config.ts";
export type { InstagramConfig, MessengerConfig, WhatsAppConfig } from "./config.ts";
export type { SendResult, TemplateInput, WhatsAppMessageKind } from "./whatsapp.ts";
export type { IgSendResult } from "./instagram.ts";
export type { MessengerSendResult } from "./messenger.ts";
export type { StoredMedia } from "./media.ts";

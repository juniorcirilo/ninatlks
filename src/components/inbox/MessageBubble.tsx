import {
  Bot,
  ExternalLink,
  FileText,
  ListChecks,
  Phone,
  Copy,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationMessage } from "@/lib/inbox";

function Media({ message }: { message: ConversationMessage }) {
  const a = message.content_attributes;
  const url = message.media_url;
  if (!url) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-xs opacity-80">
        <FileText className="h-4 w-4 shrink-0" />
        <span className="truncate">{a.filename ?? `[${a.kind ?? "mídia"}]`}</span>
      </div>
    );
  }
  switch (a.kind) {
    case "image":
    case "sticker":
      return (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={a.filename ?? "imagem"}
            loading="lazy"
            className={cn("max-h-72 rounded-md object-cover", a.kind === "sticker" && "h-32 w-32")}
          />
        </a>
      );
    case "video":
      return <video src={url} controls preload="metadata" className="max-h-72 rounded-md" />;
    case "audio":
      return <audio src={url} controls preload="metadata" className="w-60 max-w-full" />;
    default:
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5 text-xs hover:bg-black/20"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{a.filename ?? "documento"}</span>
          <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-60" />
        </a>
      );
  }
}

function Interactive({ message }: { message: ConversationMessage }) {
  const a = message.content_attributes;
  return (
    <div className="space-y-2">
      {a.title && <p className="font-semibold">{a.title}</p>}
      {a.description && <p className="whitespace-pre-wrap leading-relaxed">{a.description}</p>}
      {a.footer && <p className="text-[11px] opacity-60">{a.footer}</p>}
      <div className="flex flex-col gap-1">
        {a.kind === "buttons" &&
          a.buttons?.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-center gap-1.5 rounded-md border border-current/20 bg-black/10 px-2 py-1 text-xs"
            >
              {b.type === "url" && <ExternalLink className="h-3 w-3" />}
              {b.type === "call" && <Phone className="h-3 w-3" />}
              {b.type === "copy" && <Copy className="h-3 w-3" />}
              {b.displayText}
            </div>
          ))}
        {a.kind === "list" && (
          <>
            <div className="flex items-center justify-center gap-1.5 rounded-md border border-current/20 bg-black/10 px-2 py-1 text-xs">
              <ListChecks className="h-3 w-3" />
              {a.buttonText}
            </div>
            <ul className="space-y-0.5 text-[11px] opacity-70">
              {a.sections
                ?.flatMap((s) => s.rows)
                .map((r) => (
                  <li key={r.rowId}>• {r.title}</li>
                ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ message }: { message: ConversationMessage }) {
  const isOutbound = message.sender_type === "User" || message.sender_type === "AgentBot";
  const isBot = message.sender_type === "AgentBot";
  const a = message.content_attributes ?? {};
  const isMedia = message.content_type === 1 && a.kind && a.kind !== "text";
  const isInteractive = a.kind === "buttons" || a.kind === "list";
  const isReply = a.kind === "interactive_reply";
  const caption = isMedia ? (a.caption ?? "") : "";

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] min-w-0 break-words rounded-lg border px-3 py-2 text-sm",
          isOutbound ? "border-violet-500/15 bg-violet-500/[0.06]" : "border-border bg-background",
        )}
      >
        {isOutbound && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {isBot ? (
              <>
                <Bot className="h-3 w-3 text-violet-500" />
                <span className="text-violet-600 dark:text-violet-300">Nina</span>
              </>
            ) : (
              <>
                <UserIcon className="h-3 w-3 text-sky-500" />
                <span className="text-sky-600 dark:text-sky-300">Você</span>
              </>
            )}
          </div>
        )}

        {isInteractive ? (
          <Interactive message={message} />
        ) : isMedia ? (
          <div className="space-y-1.5">
            <Media message={message} />
            {caption && <p className="whitespace-pre-wrap leading-relaxed">{caption}</p>}
          </div>
        ) : (
          <p className="whitespace-pre-wrap leading-relaxed">
            {isReply && <span className="mr-1 opacity-60">↩ Resposta:</span>}
            {message.content}
          </p>
        )}

        <div className="mt-1 text-right text-[10px] opacity-60">
          {new Date(message.created_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

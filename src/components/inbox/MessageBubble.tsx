import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Forward,
  Reply,
  RotateCw,
  ListChecks,
  Phone,
  Copy,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";
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

function Ticks({ status }: { status?: string | null }) {
  switch (status) {
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-label="Falha no envio" />;
    case "played":
      return <CheckCheck className="h-4 w-4 text-emerald-300" aria-label="Reproduzida" />;
    case "read":
      return <CheckCheck className="h-4 w-4 text-sky-300" aria-label="Lida" />;
    case "delivered":
      return <CheckCheck className="h-4 w-4" aria-label="Entregue" />;
    default:
      return <Check className="h-4 w-4" aria-label="Enviada" />;
  }
}

export function MessageBubble({
  message,
  onReply,
  onForward,
  onResend,
}: {
  message: ConversationMessage;
  onReply?: (m: ConversationMessage) => void;
  onForward?: (m: ConversationMessage) => void;
  onResend?: (m: ConversationMessage) => Promise<void> | void;
}) {
  const [resending, setResending] = useState(false);
  const isOutbound = message.sender_type === "User" || message.sender_type === "AgentBot";
  const isBot = message.sender_type === "AgentBot";
  const a = message.content_attributes ?? {};
  const isMedia = message.content_type === 1 && a.kind && a.kind !== "text";
  const isInteractive = a.kind === "buttons" || a.kind === "list";
  const isReply = a.kind === "interactive_reply";
  const caption = isMedia ? (a.caption ?? "") : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5",
        isOutbound ? "flex-row-reverse justify-start" : "justify-start",
      )}
    >
      <div
        className={cn(
          "relative max-w-[75%] min-w-0 break-words rounded-2xl px-5 pb-3 pt-3 text-sm leading-relaxed shadow-md",
          message.delivery_status === "error" && "ring-2 ring-red-500/70",
          isOutbound
            ? isBot
              ? "rounded-tr-sm bg-gradient-to-br from-violet-600 to-purple-700 text-white shadow-violet-900/20"
              : "rounded-tr-sm bg-gradient-to-br from-[#005C4B] to-[#007B5E] text-white shadow-[#005C4B]/20"
            : "rounded-tl-sm border border-gray-300/50 bg-gray-200 text-gray-700 dark:border-slate-700/50 dark:bg-slate-800 dark:text-slate-200",
        )}
      >
        {isOutbound && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-white/80">
            {isBot ? (
              <>
                <Bot className="h-3 w-3" />
                <span>Nina</span>
              </>
            ) : (
              <>
                <UserIcon className="h-3 w-3" />
                <span>Você</span>
              </>
            )}
          </div>
        )}

        {a.forwarded && (
          <div className="mb-1 flex items-center gap-1 text-[11px] italic opacity-70">
            <Forward className="h-3 w-3" /> Encaminhada
          </div>
        )}
        {a.reply_to && (
          <div
            className={cn(
              "mb-2 rounded-lg border-l-4 px-3 py-1.5 text-xs",
              isOutbound
                ? "border-sky-300/70 bg-black/15"
                : "border-primary bg-black/10 dark:bg-black/20",
            )}
          >
            <div className="font-semibold opacity-80">
              {a.reply_to.from_me ? "Você" : "Contato"}
            </div>
            <div className="line-clamp-2 opacity-80">{a.reply_to.content ?? "Mensagem"}</div>
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

        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-bold opacity-70">
          {new Date(message.created_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {isOutbound && !isBot && <Ticks status={message.delivery_status} />}
        </div>
        {message.delivery_status === "error" && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/15 pt-2">
            <span className="text-[11px] font-medium text-red-200">
              Não enviada
              {message.delivery_error
                ? `: ${message.delivery_error}`
                : " — verifique a conexão do WhatsApp"}
            </span>
            {onResend && (
              <button
                type="button"
                disabled={resending}
                onClick={async () => {
                  setResending(true);
                  try {
                    await onResend(message);
                  } finally {
                    setResending(false);
                  }
                }}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-60"
              >
                <RotateCw className={cn("h-3 w-3", resending && "animate-spin")} />
                {resending ? "Reenviando…" : "Reenviar"}
              </button>
            )}
          </div>
        )}
      </div>
      {(onReply || onForward) && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onReply && message.delivery_status !== "error" && (
            <button
              type="button"
              title="Responder"
              aria-label="Responder"
              onClick={() => onReply(message)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200/80 text-gray-600 hover:bg-gray-300 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Reply className="h-4 w-4" />
            </button>
          )}
          {onForward && (
            <button
              type="button"
              title="Encaminhar"
              aria-label="Encaminhar"
              onClick={() => onForward(message)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200/80 text-gray-600 hover:bg-gray-300 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <Forward className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

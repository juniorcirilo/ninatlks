// Montagem de mensagens interativas (botões e lista) com pré-visualização ao vivo.
import { useEffect, useState } from "react";
import {
  Copy,
  ExternalLink,
  ListChecks,
  Loader2,
  MessageSquareReply,
  Phone,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { InteractiveButtonInput, InteractiveInput } from "@/lib/inbox";

type BtnType = InteractiveButtonInput["type"];
type BtnDraft = { type: BtnType; text: string; value: string };
type RowDraft = { title: string; description: string };
type Kind = "buttons" | "list";

const BTN_META: Record<
  BtnType,
  { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  reply: { label: "Resposta", icon: MessageSquareReply, hint: "" },
  url: { label: "Link", icon: ExternalLink, hint: "https://…" },
  copy: { label: "Copiar", icon: Copy, hint: "Código a copiar" },
  call: { label: "Ligar", icon: Phone, hint: "5511999999999" },
};

const slug = (s: string, i: number) =>
  `${
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "opcao"
  }_${i + 1}`;

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn(
        "text-[10px] tabular-nums",
        value.length >= max ? "text-amber-500" : "text-gray-400 dark:text-slate-500",
      )}
    >
      {value.length}/{max}
    </span>
  );
}

function FieldLabel({
  children,
  counter,
}: {
  children: React.ReactNode;
  counter?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <Label className="text-xs font-medium text-gray-600 dark:text-slate-300">{children}</Label>
      {counter}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSend: (input: InteractiveInput) => Promise<void>;
}

export function InteractiveDialog({ open, onOpenChange, onSend }: Props) {
  const [kind, setKind] = useState<Kind>("buttons");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<BtnDraft[]>([{ type: "reply", text: "", value: "" }]);
  const [buttonText, setButtonText] = useState("Ver opções");
  const [rows, setRows] = useState<RowDraft[]>([{ title: "", description: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("buttons");
    setTitle("");
    setDescription("");
    setFooter("");
    setButtons([{ type: "reply", text: "", value: "" }]);
    setButtonText("Ver opções");
    setRows([{ title: "", description: "" }]);
  }, [open]);

  const buttonsOk =
    !!title.trim() &&
    !!description.trim() &&
    buttons.every((b) => b.text.trim() && (b.type === "reply" || b.value.trim()));
  const listOk = !!title.trim() && !!buttonText.trim() && rows.every((r) => r.title.trim());
  const canSend = kind === "buttons" ? buttonsOk : listOk;

  const submit = async () => {
    const base = { title: title.trim(), footer: footer.trim() || undefined };
    const input: InteractiveInput =
      kind === "buttons"
        ? {
            kind: "buttons",
            ...base,
            description: description.trim(),
            buttons: buttons.map((b, i) => ({
              type: b.type,
              displayText: b.text.trim(),
              ...(b.type === "reply" && { id: slug(b.text, i) }),
              ...(b.type === "url" && { url: b.value.trim() }),
              ...(b.type === "copy" && { copyCode: b.value.trim() }),
              ...(b.type === "call" && { phoneNumber: b.value.replace(/\D/g, "") }),
            })),
          }
        : {
            kind: "list",
            ...base,
            description: description.trim() || undefined,
            buttonText: buttonText.trim(),
            sections: [
              {
                title: "Opções",
                rows: rows.map((r, i) => ({
                  title: r.title.trim(),
                  description: r.description.trim() || undefined,
                  rowId: slug(r.title, i),
                })),
              },
            ],
          };
    setBusy(true);
    try {
      await onSend(input);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Mensagem interativa</DialogTitle>
          <DialogDescription>
            Botões ou lista de opções. A escolha do contato chega no chat como resposta.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[1fr_280px]">
          {/* ─── formulário ─── */}
          <div className="space-y-5 p-6">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-gray-100/70 p-1 dark:bg-slate-900/60">
              {(
                [
                  ["buttons", "Botões", MessageSquareReply],
                  ["list", "Lista", ListChecks],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all",
                    kind === k
                      ? "bg-white text-primary shadow-sm dark:bg-slate-700 dark:text-cyan-300"
                      : "text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <FieldLabel counter={<Counter value={title} max={60} />}>Título</FieldLabel>
                <Input
                  value={title}
                  maxLength={60}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Confirmação de pedido"
                />
              </div>
              <div>
                <FieldLabel counter={<Counter value={description} max={1024} />}>
                  Texto{" "}
                  {kind === "list" && <span className="font-normal text-gray-400">(opcional)</span>}
                </FieldLabel>
                <textarea
                  rows={3}
                  value={description}
                  maxLength={1024}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Mensagem que acompanha as opções"
                  className="w-full resize-none rounded-md border border-input bg-gray-50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-secondary/50"
                />
              </div>
              <div>
                <FieldLabel counter={<Counter value={footer} max={60} />}>
                  Rodapé <span className="font-normal text-gray-400">(opcional)</span>
                </FieldLabel>
                <Input value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} />
              </div>
            </div>

            {kind === "buttons" ? (
              <div className="space-y-2">
                <FieldLabel
                  counter={<span className="text-[10px] text-gray-400">{buttons.length}/3</span>}
                >
                  Botões
                </FieldLabel>
                {buttons.map((b, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-xl border border-border bg-gray-50/60 p-3 dark:bg-slate-900/40"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-1 flex-wrap gap-1">
                        {(Object.keys(BTN_META) as BtnType[]).map((t) => {
                          const M = BTN_META[t];
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() =>
                                setButtons((p) =>
                                  p.map((x, j) => (j === i ? { ...x, type: t, value: "" } : x)),
                                )
                              }
                              className={cn(
                                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                                b.type === t
                                  ? "border-primary/40 bg-primary/10 text-primary dark:text-cyan-300"
                                  : "border-border text-gray-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800",
                              )}
                            >
                              <M.icon className="h-3 w-3" />
                              {M.label}
                            </button>
                          );
                        })}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={buttons.length === 1}
                        onClick={() => setButtons((p) => p.filter((_, j) => j !== i))}
                        aria-label="Remover botão"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Texto do botão"
                        maxLength={25}
                        value={b.text}
                        onChange={(e) =>
                          setButtons((p) =>
                            p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                          )
                        }
                      />
                      <Counter value={b.text} max={25} />
                    </div>
                    {b.type !== "reply" && (
                      <Input
                        placeholder={BTN_META[b.type].hint}
                        value={b.value}
                        onChange={(e) =>
                          setButtons((p) =>
                            p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                  </div>
                ))}
                {buttons.length < 3 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setButtons((p) => [...p, { type: "reply", text: "", value: "" }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar botão
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <FieldLabel counter={<Counter value={buttonText} max={20} />}>
                    Texto do botão que abre a lista
                  </FieldLabel>
                  <Input
                    value={buttonText}
                    maxLength={20}
                    onChange={(e) => setButtonText(e.target.value)}
                  />
                </div>
                <FieldLabel
                  counter={<span className="text-[10px] text-gray-400">{rows.length}/10</span>}
                >
                  Opções
                </FieldLabel>
                {rows.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-border bg-gray-50/60 p-3 dark:bg-slate-900/40"
                  >
                    <span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary dark:text-cyan-300">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        placeholder="Título da opção"
                        maxLength={24}
                        value={r.title}
                        onChange={(e) =>
                          setRows((p) =>
                            p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        placeholder="Descrição (opcional)"
                        maxLength={72}
                        value={r.description}
                        onChange={(e) =>
                          setRows((p) =>
                            p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={rows.length === 1}
                      onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                      aria-label="Remover opção"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {rows.length < 10 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRows((p) => [...p, { title: "", description: "" }])}
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar opção
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ─── pré-visualização ─── */}
          <aside className="hidden border-l border-border bg-gray-50 p-5 dark:bg-[#0B0E14] md:block">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-500">
              Pré-visualização
            </p>
            <div className="rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#005C4B] to-[#007B5E] p-4 text-sm text-white shadow-md">
              <p className="font-semibold">{title || "Título"}</p>
              {(description || kind === "buttons") && (
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-white/90">
                  {description || "Texto da mensagem"}
                </p>
              )}
              {footer && <p className="mt-2 text-[11px] text-white/60">{footer}</p>}
              <div className="mt-3 flex flex-col gap-1">
                {kind === "buttons" ? (
                  buttons.map((b, i) => {
                    const Icon = BTN_META[b.type].icon;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1.5 text-xs font-medium"
                      >
                        {b.type !== "reply" && <Icon className="h-3 w-3" />}
                        {b.text || "Botão"}
                      </div>
                    );
                  })
                ) : (
                  <>
                    <div className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1.5 text-xs font-medium">
                      <ListChecks className="h-3 w-3" />
                      {buttonText || "Ver opções"}
                    </div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-white/70">
                      {rows.map((r, i) => (
                        <li key={i} className="truncate">
                          • {r.title || `Opção ${i + 1}`}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-gray-500 dark:text-slate-500">
              O WhatsApp não suporta oficialmente mensagens interativas; podem não aparecer em todos
              os aparelhos.
            </p>
          </aside>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3 sm:space-x-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSend || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

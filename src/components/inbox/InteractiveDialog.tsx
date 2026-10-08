// Montagem de mensagens interativas (templates, botões, lista, mídia, PIX) com IA e pré-visualização.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  CalendarCheck,
  CalendarDays,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  MessageSquareReply,
  Paperclip,
  Phone,
  Plus,
  QrCode,
  Rocket,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  ThumbsUp,
  Ticket,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  generateInteractiveDraft,
  type DraftTemplate,
  type PixKeyType,
  type InteractiveButtonInput,
  type InteractiveInput,
} from "@/lib/inbox";

type BtnType = InteractiveButtonInput["type"];
type BtnDraft = { type: BtnType; text: string; value: string };
type RowDraft = { title: string; description: string };
type Mode = "reply" | "action";

const MAX_MEDIA_MB = 16;

const BTN_META: Record<
  BtnType,
  { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  reply: { label: "Resposta", icon: MessageSquareReply, hint: "" },
  url: { label: "Link", icon: ExternalLink, hint: "https://…" },
  copy: { label: "Copiar", icon: Copy, hint: "Código a copiar" },
  call: { label: "Ligar", icon: Phone, hint: "5511999999999" },
};

type Field = { key: string; label: string; placeholder: string; required?: boolean };
type Preset = {
  title: string;
  description: string;
  footer?: string;
  buttons?: BtnDraft[];
  buttonText?: string;
  rows?: string[];
};
type TemplateMeta = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "basic" | "marketing";
  kind: "buttons" | "list";
  media: "none" | "image" | "video" | "optional-image" | "optional-media";
  buttons: boolean;
  mode?: Mode;
  /** Botão "copiar" adicionado sozinho com o valor do campo `code`. */
  autoCopy?: string;
  fields?: Field[];
  compose?: (x: Record<string, string>) => (string | false | undefined)[];
  preset?: Preset;
  promptHint: string;
};

const btn = (type: BtnType, text: string): BtnDraft => ({ type, text, value: "" });

const TEMPLATES: Record<DraftTemplate, TemplateMeta> = {
  buttons: {
    label: "Botões",
    icon: MessageSquareReply,
    group: "basic",
    kind: "buttons",
    media: "none",
    buttons: true,
    promptHint: "Ex.: confirmar o agendamento da consulta e oferecer remarcar ou cancelar",
  },
  list: {
    label: "Lista de opções",
    icon: ListChecks,
    group: "basic",
    kind: "list",
    media: "none",
    buttons: false,
    promptHint: "Ex.: menu de atendimento com setores comercial, financeiro e suporte",
  },
  image_buttons: {
    label: "Imagem + botões",
    icon: ImageIcon,
    group: "basic",
    kind: "buttons",
    media: "image",
    buttons: true,
    promptHint: "Ex.: divulgar a promoção de outubro com 20% de desconto",
  },
  video_buttons: {
    label: "Vídeo + botões",
    icon: Video,
    group: "basic",
    kind: "buttons",
    media: "video",
    buttons: true,
    promptHint: "Ex.: apresentar o novo serviço e convidar para agendar uma demonstração",
  },
  pix: {
    label: "PIX",
    icon: QrCode,
    group: "basic",
    kind: "buttons",
    media: "none",
    buttons: false,
    promptHint: "Ex.: cobrar a mensalidade de R$ 150,00 com chave 11999999999 em nome de Maria",
  },
  link_image_buttons: {
    label: "Link + imagem + botões",
    icon: Link2,
    group: "basic",
    kind: "buttons",
    media: "image",
    buttons: true,
    promptHint: "Ex.: convidar para o evento, link https://site.com/evento, com botão de confirmar",
  },
  coupon: {
    label: "Cupom de desconto",
    icon: Ticket,
    group: "marketing",
    kind: "buttons",
    media: "optional-image",
    buttons: true,
    mode: "action",
    autoCopy: "Copiar cupom",
    fields: [
      { key: "code", label: "Código do cupom", placeholder: "BEMVINDO10", required: true },
      { key: "validity", label: "Validade (opcional)", placeholder: "até 31/10" },
    ],
    compose: (x) => [
      x.code && `🎟️ Cupom: *${x.code}*`,
      x.validity && `⏳ Válido ${x.validity}`,
    ],
    preset: {
      title: "Cupom exclusivo para você 🎁",
      description:
        "Separamos um desconto especial para a sua próxima compra. É só aplicar o cupom no checkout.",
      footer: "Oferta por tempo limitado",
      buttons: [],
    },
    promptHint: "Ex.: cupom BEMVINDO10 de 10% na primeira compra, válido até o fim do mês",
  },
  promo: {
    label: "Promoção / oferta",
    icon: Tag,
    group: "marketing",
    kind: "buttons",
    media: "optional-image",
    buttons: true,
    mode: "action",
    fields: [
      { key: "priceFrom", label: "Preço antigo (R$)", placeholder: "199,90" },
      { key: "priceTo", label: "Preço promocional (R$)", placeholder: "149,90", required: true },
      { key: "validity", label: "Validade (opcional)", placeholder: "só até domingo" },
    ],
    compose: (x) => [
      x.priceTo &&
        (x.priceFrom
          ? `De ~R$ ${x.priceFrom}~ por *R$ ${x.priceTo}*`
          : `Por apenas *R$ ${x.priceTo}*`),
      x.validity && `⏳ ${x.validity}`,
    ],
    preset: {
      title: "Oferta imperdível 🔥",
      description: "Condição especial só para você. Garanta o seu antes que acabe!",
      buttons: [btn("url", "Aproveitar agora")],
    },
    promptHint: "Ex.: tênis de corrida de R$ 299 por R$ 199, só até domingo, com link da loja",
  },
  launch: {
    label: "Lançamento",
    icon: Rocket,
    group: "marketing",
    kind: "buttons",
    media: "optional-media",
    buttons: true,
    mode: "action",
    preset: {
      title: "Novidade chegando 🚀",
      description:
        "Acabamos de lançar algo pensado para você. Conheça os detalhes e seja um dos primeiros a aproveitar.",
      buttons: [btn("url", "Conhecer agora")],
    },
    promptHint: "Ex.: lançamento do nosso novo plano anual com 2 meses grátis",
  },
  event: {
    label: "Convite para evento",
    icon: CalendarDays,
    group: "marketing",
    kind: "buttons",
    media: "optional-image",
    buttons: true,
    mode: "reply",
    fields: [
      { key: "date", label: "Data e hora", placeholder: "15/11, às 19h", required: true },
      { key: "place", label: "Local (opcional)", placeholder: "Rua X, 123 ou link online" },
    ],
    compose: (x) => [x.date && `📅 ${x.date}`, x.place && `📍 ${x.place}`],
    preset: {
      title: "Você está convidado(a)! 🎉",
      description: "Preparamos um evento especial e queremos você com a gente. Confirme sua presença:",
      buttons: [btn("reply", "Vou participar"), btn("reply", "Não poderei ir")],
    },
    promptHint: "Ex.: workshop gratuito de vendas dia 15/11 às 19h, com confirmação de presença",
  },
  booking: {
    label: "Confirmação de agendamento",
    icon: CalendarCheck,
    group: "marketing",
    kind: "buttons",
    media: "none",
    buttons: true,
    mode: "reply",
    fields: [
      { key: "date", label: "Data e hora", placeholder: "12/11, às 14h30", required: true },
      { key: "place", label: "Local (opcional)", placeholder: "Unidade Centro" },
    ],
    compose: (x) => [x.date && `🗓️ ${x.date}`, x.place && `📍 ${x.place}`],
    preset: {
      title: "Confirmação de agendamento",
      description: "Seu horário está reservado. Podemos confirmar?",
      buttons: [btn("reply", "Confirmar"), btn("reply", "Remarcar"), btn("reply", "Cancelar")],
    },
    promptHint: "Ex.: lembrete da consulta de amanhã pedindo para confirmar, remarcar ou cancelar",
  },
  nps: {
    label: "Pesquisa de satisfação",
    icon: Star,
    group: "marketing",
    kind: "list",
    media: "none",
    buttons: false,
    preset: {
      title: "Como foi sua experiência?",
      description:
        "Sua opinião ajuda a melhorar nosso atendimento. Toque em Avaliar e escolha uma nota.",
      buttonText: "Avaliar",
      rows: ["⭐⭐⭐⭐⭐ Excelente", "⭐⭐⭐⭐ Muito bom", "⭐⭐⭐ Regular", "⭐⭐ Ruim", "⭐ Péssimo"],
    },
    promptHint: "Ex.: pesquisa de satisfação após o atendimento na loja",
  },
  review: {
    label: "Pedir avaliação",
    icon: ThumbsUp,
    group: "marketing",
    kind: "buttons",
    media: "optional-image",
    buttons: true,
    mode: "action",
    preset: {
      title: "Sua opinião vale muito ⭐",
      description:
        "Foi um prazer atender você! Se puder, deixe sua avaliação — leva menos de 1 minuto.",
      buttons: [btn("url", "Avaliar agora")],
    },
    promptHint: "Ex.: pedir avaliação no Google depois da compra",
  },
  cart: {
    label: "Recuperar carrinho",
    icon: ShoppingCart,
    group: "marketing",
    kind: "buttons",
    media: "optional-image",
    buttons: true,
    mode: "reply",
    preset: {
      title: "Esqueceu algo no carrinho? 🛒",
      description: "Seus itens ainda estão reservados por pouco tempo. Quer ajuda para finalizar?",
      buttons: [btn("reply", "Finalizar compra"), btn("reply", "Preciso de ajuda")],
    },
    promptHint: "Ex.: lembrar do carrinho abandonado com tom leve e oferecer ajuda",
  },
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

const emptyButton = (mode: Mode): BtnDraft => ({
  type: mode === "reply" ? "reply" : "url",
  text: "",
  value: "",
});

const inferType = (value: string): BtnType => {
  const v = value.trim();
  if (/^(https?:\/\/|www\.)/i.test(v)) return "url";
  if (/^\+?[\d\s()-]{8,}$/.test(v)) return "call";
  return "copy";
};

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

function Field({
  label,
  counter,
  className,
  children,
}: {
  label: React.ReactNode;
  counter?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-600 dark:text-slate-300">{label}</span>
        {counter}
      </div>
      {children}
    </div>
  );
}

const inputCls = "h-8 text-xs";
const areaCls =
  "w-full resize-none rounded-md border border-input bg-gray-50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-secondary/50";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string | null | undefined;
  onSend: (input: InteractiveInput, media?: File | null) => Promise<void>;
  onSendPix: (pix: {
    key: string;
    keyType: PixKeyType;
    title?: string;
    description?: string;
    footer?: string;
    beneficiary?: string;
    amount?: string;
  }) => Promise<void>;
}

const PIX_TYPES: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "Telefone",
  email: "E-mail",
  random: "Chave aleatória",
};

const isCopiaECola = (k: string) => /^000201/.test(k.trim());

function detectPixType(key: string): PixKeyType {
  const k = key.trim();
  if (k.includes("@")) return "email";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return "random";
  const d = k.replace(/\D/g, "");
  if (k.startsWith("+") || (d.length >= 12 && d.startsWith("55"))) return "phone";
  if (d.length === 14) return "cnpj";
  if (d.length === 11) return "cpf";
  return "random";
}

export function InteractiveDialog({ open, onOpenChange, accountId, onSend, onSendPix }: Props) {
  const [template, setTemplate] = useState<DraftTemplate>("buttons");
  const [mode, setMode] = useState<Mode>("reply");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<BtnDraft[]>([emptyButton("reply")]);
  const [buttonText, setButtonText] = useState("Ver opções");
  const [rows, setRows] = useState<RowDraft[]>([{ title: "", description: "" }]);
  const [link, setLink] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixName, setPixName] = useState("");
  const [pixType, setPixType] = useState<PixKeyType>("cpf");
  const [pixTypeTouched, setPixTypeTouched] = useState(false);
  const [pixAmount, setPixAmount] = useState("");
  const [media, setMedia] = useState<File | null>(null);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const lastPreset = useRef<{ title: string; description: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = TEMPLATES[template];
  const isList = meta.kind === "list";
  const maxButtons = meta.autoCopy ? 2 : 3;
  const isPix = template === "pix";
  const mediaUrl = useMemo(() => (media ? URL.createObjectURL(media) : null), [media]);
  useEffect(() => () => void (mediaUrl && URL.revokeObjectURL(mediaUrl)), [mediaUrl]);

  useEffect(() => {
    if (!open) return;
    setTemplate("buttons");
    setMode("reply");
    setTitle("");
    setDescription("");
    setFooter("");
    setButtons([emptyButton("reply")]);
    setButtonText("Ver opções");
    setRows([{ title: "", description: "" }]);
    setLink("");
    setPixKey("");
    setPixName("");
    setPixType("cpf");
    setPixTypeTouched(false);
    setPixAmount("");
    setMedia(null);
    setExtras({});
    lastPreset.current = null;
    setPrompt("");
  }, [open]);

  const changeTemplate = (t: DraftTemplate) => {
    const next = TEMPLATES[t];
    setTemplate(t);
    setExtras({});
    const m = next.media;
    const isVideo = media?.type.startsWith("video/");
    if (
      media &&
      (m === "none" ||
        (m === "video" && !isVideo) ||
        ((m === "image" || m === "optional-image") && isVideo))
    )
      setMedia(null);

    const untouched =
      (!title.trim() && !description.trim()) ||
      (lastPreset.current &&
        title === lastPreset.current.title &&
        description === lastPreset.current.description);
    const nextMode: Mode = next.mode ?? "reply";
    setMode(nextMode);
    if (!untouched) {
      setButtons((p) =>
        p.map((b) =>
          nextMode === "reply"
            ? { ...b, type: "reply", value: "" }
            : b.type === "reply"
              ? { ...b, type: "url", value: "" }
              : b,
        ),
      );
      return;
    }
    const pr = next.preset;
    setTitle(pr?.title ?? "");
    setDescription(pr?.description ?? "");
    setFooter(pr?.footer ?? "");
    setButtons(
      pr?.buttons ? pr.buttons.map((b) => ({ ...b })) : next.autoCopy ? [] : [emptyButton(nextMode)],
    );
    setButtonText(pr?.buttonText ?? "Ver opções");
    setRows(
      pr?.rows
        ? pr.rows.map((r) => ({ title: r, description: "" }))
        : [{ title: "", description: "" }],
    );
    lastPreset.current = pr ? { title: pr.title, description: pr.description } : null;
  };

  const changeMode = (m: Mode) => {
    setMode(m);
    setButtons((p) =>
      p.map((b) =>
        m === "reply"
          ? { ...b, type: "reply", value: "" }
          : b.type === "reply"
            ? { ...b, type: "url", value: "" }
            : b,
      ),
    );
  };

  const pickMedia = (f: File | undefined) => {
    if (!f) return;
    const okImage = f.type.startsWith("image/");
    const okVideo = f.type.startsWith("video/");
    const ok =
      meta.media === "video"
        ? okVideo
        : meta.media === "optional-media"
          ? okImage || okVideo
          : okImage;
    if (!ok) {
      toast.error(
        meta.media === "video"
          ? "Selecione um vídeo."
          : meta.media === "optional-media"
            ? "Selecione uma imagem ou vídeo."
            : "Selecione uma imagem.",
      );
      return;
    }
    if (f.size > MAX_MEDIA_MB * 1024 * 1024) {
      toast.error(`Arquivo maior que ${MAX_MEDIA_MB} MB.`);
      return;
    }
    setMedia(f);
  };

  const finalDescription = useMemo(() => {
    if (isPix) {
      const lines = [description.trim()];
      if (pixName.trim()) lines.push(`Beneficiário: ${pixName.trim()}`);
      if (pixAmount.trim()) lines.push(`Valor: R$ ${pixAmount.trim().replace(/^R\$\s*/i, "")}`);
      if (pixKey.trim() && !isCopiaECola(pixKey))
        lines.push(`Chave PIX (${PIX_TYPES[pixType]}):\n${pixKey.trim()}`);
      return lines.filter(Boolean).join("\n");
    }
    if (template === "link_image_buttons" && link.trim()) {
      return [description.trim(), link.trim()].filter(Boolean).join("\n\n");
    }
    const extra = (meta.compose?.(extras) ?? []).filter(Boolean) as string[];
    return [description.trim(), ...extra].filter(Boolean).join("\n\n").trim();
  }, [isPix, template, meta, extras, description, pixName, pixAmount, pixKey, pixType, link]);

  const effectiveTitle = title.trim() || (isPix ? "Pagamento via PIX" : "");

  const fieldsOk = (meta.fields ?? []).every((f) => !f.required || !!extras[f.key]?.trim());
  const buttonsOk =
    (buttons.length > 0 || !!meta.autoCopy) &&
    buttons.every((b) => b.text.trim() && (b.type === "reply" || b.value.trim()));
  const mediaOk =
    meta.media === "image" || meta.media === "video" ? !!media : true;
  const canSend = isList
    ? !!title.trim() && !!buttonText.trim() && rows.every((r) => r.title.trim())
    : isPix
      ? !!pixKey.trim() && finalDescription.length <= 1024
      : !!effectiveTitle &&
        !!description.trim() &&
        buttonsOk &&
        fieldsOk &&
        mediaOk &&
        finalDescription.length <= 1024 &&
        (template !== "link_image_buttons" || !!link.trim());

  const generate = async () => {
    if (!accountId || prompt.trim().length < 3) return;
    setGenerating(true);
    try {
      const d = await generateInteractiveDraft(accountId, {
        template,
        prompt: prompt.trim(),
        buttonMode: mode,
      });
      if (d.title) setTitle(d.title);
      if (d.description) setDescription(d.description);
      if (d.footer !== undefined) setFooter(d.footer ?? "");
      if (isList) {
        if (d.buttonText) setButtonText(d.buttonText);
        if (d.rows?.length)
          setRows(
            d.rows.map((r) => ({ title: r.title, description: r.description ?? "" })),
          );
      } else if (isPix) {
        if (d.key) setPixKey(d.key);
        if (d.beneficiary) setPixName(d.beneficiary);
        if (d.amount) setPixAmount(d.amount);
      } else if (d.buttons?.length) {
        setButtons(
          d.buttons
            .filter((b) => b.text)
            .map((b) =>
              mode === "reply"
                ? { type: "reply" as const, text: b.text, value: "" }
                : { type: inferType(b.value ?? ""), text: b.text, value: b.value ?? "" },
            ),
        );
      }
      if (template === "link_image_buttons" && d.link) setLink(d.link);
      if (d.fields && meta.fields) {
        const known = new Set(meta.fields.map((f) => f.key));
        setExtras((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(d.fields!).filter(([k, v]) => known.has(k) && v)),
        }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar com a IA");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    if (isPix) {
      setBusy(true);
      try {
        await onSendPix({
          key: pixKey.trim(),
          keyType: pixType,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          footer: footer.trim() || undefined,
          beneficiary: pixName.trim() || undefined,
          amount: pixAmount.trim() || undefined,
        });
        onOpenChange(false);
      } finally {
        setBusy(false);
      }
      return;
    }
    let input: InteractiveInput;
    if (isList) {
      input = {
        kind: "list",
        title: title.trim(),
        footer: footer.trim() || undefined,
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
    } else {
      const own: InteractiveButtonInput[] = buttons.map((b, i) => ({
        type: b.type,
        displayText: b.text.trim(),
        ...(b.type === "reply" && { id: slug(b.text, i) }),
        ...(b.type === "url" && { url: b.value.trim() }),
        ...(b.type === "copy" && { copyCode: b.value.trim() }),
        ...(b.type === "call" && { phoneNumber: b.value.replace(/\D/g, "") }),
      }));
      const list: InteractiveButtonInput[] = isPix
        ? [{ type: "copy", displayText: "Copiar chave PIX", copyCode: pixKey.trim() }]
        : meta.autoCopy
          ? [
              { type: "copy", displayText: meta.autoCopy, copyCode: (extras.code ?? "").trim() },
              ...own,
            ]
          : own;
      input = {
        kind: "buttons",
        title: effectiveTitle,
        footer: footer.trim() || undefined,
        description: finalDescription,
        buttons: list,
      };
    }
    setBusy(true);
    try {
      await onSend(input, isList || meta.media === "none" ? null : media);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const showMedia = meta.media !== "none";
  const accept =
    meta.media === "video"
      ? "video/*"
      : meta.media === "optional-media"
        ? "image/*,video/*"
        : "image/*";
  const mediaOptional = meta.media === "optional-image" || meta.media === "optional-media";

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="flex h-[80vh] max-h-[80vh] w-[80vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:rounded-lg">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base">Mensagem interativa</DialogTitle>
          <DialogDescription className="text-xs">
            Escolha um template; a resposta do contato chega no chat.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[1fr_400px]">
          {/* ─── formulário ─── */}
          <div className="mx-auto w-full max-w-3xl space-y-3 p-6">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Template" className="min-w-[180px] flex-1">
                <Select value={template} onValueChange={(v) => changeTemplate(v as DraftTemplate)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      [
                        ["basic", "Básicos"],
                        ["marketing", "Marketing"],
                      ] as const
                    ).map(([g, gl]) => (
                      <SelectGroup key={g}>
                        <SelectLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                          {gl}
                        </SelectLabel>
                        {(Object.keys(TEMPLATES) as DraftTemplate[])
                          .filter((t) => TEMPLATES[t].group === g)
                          .map((t) => {
                            const T = TEMPLATES[t];
                            return (
                              <SelectItem key={t} value={t}>
                                <span className="flex items-center gap-2">
                                  <T.icon className="h-3.5 w-3.5" />
                                  {T.label}
                                </span>
                              </SelectItem>
                            );
                          })}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {meta.buttons && (
                <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-gray-100/70 p-0.5 dark:bg-slate-900/60">
                  {(
                    [
                      ["reply", "Respostas"],
                      ["action", "Ações"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => changeMode(m)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all",
                        mode === m
                          ? "bg-white text-primary shadow-sm dark:bg-slate-700 dark:text-cyan-300"
                          : "text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ─── IA ─── */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2">
              <div className="flex items-start gap-2">
                <textarea
                  rows={2}
                  value={prompt}
                  maxLength={1500}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={meta.promptHint}
                  className={cn(areaCls, "flex-1 bg-background")}
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0 gap-1 text-xs"
                  onClick={generate}
                  disabled={generating || prompt.trim().length < 3 || !accountId}
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Gerar com IA
                </Button>
              </div>
            </div>

            {showMedia && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept={accept}
                  hidden
                  onChange={(e) => {
                    pickMedia(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {media ? (
                  <>
                    {media.type.startsWith("video/") ? (
                      <Video className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs">{media.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setMedia(null)}
                      aria-label="Remover mídia"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex flex-1 items-center gap-2 text-xs text-gray-500 hover:text-primary dark:text-slate-400"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {meta.media === "video"
                      ? "Anexar vídeo"
                      : meta.media === "optional-media"
                        ? "Anexar imagem ou vídeo (opcional)"
                        : mediaOptional
                          ? "Anexar imagem (opcional)"
                          : "Anexar imagem"}
                  </button>
                )}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Título" counter={<Counter value={title} max={60} />}>
                <Input
                  className={inputCls}
                  value={title}
                  maxLength={60}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isPix ? "Pagamento via PIX" : "Ex.: Confirmação de pedido"}
                />
              </Field>
              <Field
                label={
                  <>
                    Rodapé <span className="font-normal text-gray-400">(opcional)</span>
                  </>
                }
                counter={<Counter value={footer} max={60} />}
              >
                <Input
                  className={inputCls}
                  value={footer}
                  maxLength={60}
                  onChange={(e) => setFooter(e.target.value)}
                />
              </Field>
            </div>

            <Field
              label={
                <>
                  Texto{" "}
                  {(isList || isPix) && <span className="font-normal text-gray-400">(opcional)</span>}
                </>
              }
              counter={<Counter value={description} max={1024} />}
            >
              <textarea
                rows={2}
                value={description}
                maxLength={1024}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mensagem que acompanha as opções"
                className={areaCls}
              />
            </Field>

            {meta.fields && (
              <div className="grid gap-2 sm:grid-cols-2">
                {meta.fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Input
                      className={inputCls}
                      value={extras[f.key] ?? ""}
                      placeholder={f.placeholder}
                      onChange={(e) => setExtras((p) => ({ ...p, [f.key]: e.target.value }))}
                    />
                  </Field>
                ))}
              </div>
            )}

            {template === "link_image_buttons" && (
              <Field label="Link">
                <Input
                  className={inputCls}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </Field>
            )}

            {isPix && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Chave PIX" className="sm:col-span-2">
                  <div className="flex gap-1.5">
                    {!isCopiaECola(pixKey) && (
                      <Select
                        value={pixType}
                        onValueChange={(v) => {
                          setPixType(v as PixKeyType);
                          setPixTypeTouched(true);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[140px] shrink-0 text-xs" aria-label="Tipo da chave">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PIX_TYPES) as PixKeyType[]).map((t) => (
                            <SelectItem key={t} value={t}>
                              {PIX_TYPES[t]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      className={inputCls}
                      value={pixKey}
                      onChange={(e) => {
                        setPixKey(e.target.value);
                        if (!pixTypeTouched) setPixType(detectPixType(e.target.value));
                      }}
                      placeholder="Chave ou PIX copia e cola"
                    />
                  </div>
                </Field>
                <Field label="Beneficiário (opcional)">
                  <Input
                    className={inputCls}
                    value={pixName}
                    onChange={(e) => setPixName(e.target.value)}
                  />
                </Field>
                <Field label="Valor (opcional)">
                  <Input
                    className={inputCls}
                    value={pixAmount}
                    onChange={(e) => setPixAmount(e.target.value)}
                    placeholder="150,00"
                  />
                </Field>
              </div>
            )}

            {meta.buttons && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-slate-300">
                    Botões
                  </span>
                  <span className="text-[10px] text-gray-400">{buttons.length}/{maxButtons}</span>
                </div>
                {buttons.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    {mode === "action" && (
                      <Select
                        value={b.type}
                        onValueChange={(t) =>
                          setButtons((p) =>
                            p.map((x, j) =>
                              j === i ? { ...x, type: t as BtnType, value: "" } : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[104px] text-xs" aria-label="Tipo do botão">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["url", "call", "copy"] as BtnType[]).map((t) => {
                            const M = BTN_META[t];
                            return (
                              <SelectItem key={t} value={t}>
                                <span className="flex items-center gap-2">
                                  <M.icon className="h-3.5 w-3.5" />
                                  {M.label}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      className={cn(inputCls, "min-w-[110px] flex-1")}
                      placeholder="Texto do botão"
                      maxLength={25}
                      value={b.text}
                      onChange={(e) =>
                        setButtons((p) =>
                          p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                        )
                      }
                    />
                    {b.type !== "reply" && (
                      <Input
                        className={cn(inputCls, "min-w-[110px] flex-1")}
                        placeholder={BTN_META[b.type].hint}
                        value={b.value}
                        onChange={(e) =>
                          setButtons((p) =>
                            p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={buttons.length === 1 && !meta.autoCopy}
                      onClick={() => setButtons((p) => p.filter((_, j) => j !== i))}
                      aria-label="Remover botão"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {buttons.length < maxButtons && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setButtons((p) => [...p, emptyButton(mode)])}
                  >
                    <Plus className="h-3 w-3" /> Adicionar botão
                  </Button>
                )}
              </div>
            )}

            {isList && (
              <div className="space-y-1.5">
                <Field
                  label="Texto do botão que abre a lista"
                  counter={<Counter value={buttonText} max={20} />}
                >
                  <Input
                    className={inputCls}
                    value={buttonText}
                    maxLength={20}
                    onChange={(e) => setButtonText(e.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-slate-300">
                    Opções
                  </span>
                  <span className="text-[10px] text-gray-400">{rows.length}/10</span>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary dark:text-cyan-300">
                      {i + 1}
                    </span>
                    <Input
                      className={cn(inputCls, "flex-1")}
                      placeholder="Título"
                      maxLength={24}
                      value={r.title}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      className={cn(inputCls, "flex-1")}
                      placeholder="Descrição (opcional)"
                      maxLength={72}
                      value={r.description}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={rows.length === 1}
                      onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                      aria-label="Remover opção"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {rows.length < 10 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setRows((p) => [...p, { title: "", description: "" }])}
                  >
                    <Plus className="h-3 w-3" /> Adicionar opção
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ─── pré-visualização ─── */}
          <aside className="hidden border-l border-border bg-gray-50 p-6 dark:bg-[#0B0E14] md:block">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-500">
              Pré-visualização
            </p>
            <div className="overflow-hidden rounded-2xl rounded-tr-sm bg-gradient-to-br from-[#005C4B] to-[#007B5E] text-xs text-white shadow-md">
              {isPix && (
                <div className="flex flex-col items-center gap-1 bg-white py-3 text-[10px] text-gray-500">
                  <QrCode className="h-16 w-16 text-gray-800" />
                  QR Code gerado ao enviar
                </div>
              )}
              {mediaUrl &&
                (media?.type.startsWith("video/") ? (
                  <video src={mediaUrl} className="max-h-64 w-full object-cover" muted />
                ) : (
                  <img src={mediaUrl} alt="" className="max-h-64 w-full object-cover" />
                ))}
              <div className="p-3">
                <p className="font-semibold">{effectiveTitle || "Título"}</p>
                {(finalDescription || !isList) && (
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-white/90">
                    {finalDescription || "Texto da mensagem"}
                  </p>
                )}
                {footer && <p className="mt-1.5 text-[10px] text-white/60">{footer}</p>}
                <div className="mt-2 flex flex-col gap-1">
                  {isList ? (
                    <>
                      <div className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 font-medium">
                        <ListChecks className="h-3 w-3" />
                        {buttonText || "Ver opções"}
                      </div>
                      <ul className="mt-0.5 space-y-0.5 text-[10px] text-white/70">
                        {rows.map((r, i) => (
                          <li key={i} className="truncate">
                            • {r.title || `Opção ${i + 1}`}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : isPix ? (
                    <div className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 font-medium">
                      <Copy className="h-3 w-3" />
                      Copiar chave PIX
                    </div>
                  ) : (
                    <>
                      {meta.autoCopy && (
                        <div className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 font-medium">
                          <Copy className="h-3 w-3" />
                          {meta.autoCopy}
                        </div>
                      )}
                      {buttons.map((b, i) => {
                        const Icon = BTN_META[b.type].icon;
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 font-medium"
                          >
                            {b.type !== "reply" && <Icon className="h-3 w-3" />}
                            {b.text || "Botão"}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-gray-500 dark:text-slate-500">
              O WhatsApp não suporta oficialmente mensagens interativas; podem não aparecer em todos
              os aparelhos.
            </p>
          </aside>
        </div>

        <DialogFooter className="border-t border-border px-4 py-2.5 sm:space-x-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSend || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

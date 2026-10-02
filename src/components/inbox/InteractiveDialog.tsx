// Montagem de mensagens interativas (botões e lista) para enviar no chat.
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InteractiveButtonInput, InteractiveInput } from "@/lib/inbox";

type BtnDraft = { type: InteractiveButtonInput["type"]; text: string; value: string };
type RowDraft = { title: string; description: string };

const BTN_LABEL: Record<BtnDraft["type"], string> = {
  reply: "Resposta rápida",
  url: "Link",
  copy: "Copiar código",
  call: "Ligar",
};
const BTN_VALUE_HINT: Record<BtnDraft["type"], string> = {
  reply: "",
  url: "https://…",
  copy: "Código a copiar",
  call: "5511999999999",
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSend: (input: InteractiveInput) => Promise<void>;
}

export function InteractiveDialog({ open, onOpenChange, onSend }: Props) {
  const [tab, setTab] = useState<"buttons" | "list">("buttons");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<BtnDraft[]>([{ type: "reply", text: "", value: "" }]);
  const [buttonText, setButtonText] = useState("Ver opções");
  const [rows, setRows] = useState<RowDraft[]>([{ title: "", description: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("buttons");
    setTitle("");
    setDescription("");
    setFooter("");
    setButtons([{ type: "reply", text: "", value: "" }]);
    setButtonText("Ver opções");
    setRows([{ title: "", description: "" }]);
  }, [open]);

  const buttonsOk =
    title.trim() &&
    description.trim() &&
    buttons.length > 0 &&
    buttons.every((b) => b.text.trim() && (b.type === "reply" || b.value.trim()));
  const listOk =
    title.trim() && buttonText.trim() && rows.length > 0 && rows.every((r) => r.title.trim());
  const canSend = tab === "buttons" ? buttonsOk : listOk;

  const submit = async () => {
    const base = { title: title.trim(), footer: footer.trim() || undefined };
    const input: InteractiveInput =
      tab === "buttons"
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mensagem interativa</DialogTitle>
          <DialogDescription>
            Botões ou lista de opções. O contato responde tocando — a escolha chega no chat.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "buttons" | "list")}>
          <TabsList>
            <TabsTrigger value="buttons">Botões</TabsTrigger>
            <TabsTrigger value="list">Lista</TabsTrigger>
          </TabsList>

          <div className="mt-3 space-y-3">
            <div>
              <Label className="text-xs">Título</Label>
              <Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Texto{tab === "list" ? " (opcional)" : ""}</Label>
              <Textarea
                rows={2}
                value={description}
                maxLength={1024}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Rodapé (opcional)</Label>
              <Input value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} />
            </div>
          </div>

          <TabsContent value="buttons" className="space-y-2">
            <Label className="text-xs">Botões (máx. 3)</Label>
            {buttons.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <Select
                  value={b.type}
                  onValueChange={(v) =>
                    setButtons((p) =>
                      p.map((x, j) =>
                        j === i ? { ...x, type: v as BtnDraft["type"], value: "" } : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="w-[140px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(BTN_LABEL) as BtnDraft["type"][]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {BTN_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="min-w-0 flex-1 space-y-1">
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
                  {b.type !== "reply" && (
                    <Input
                      placeholder={BTN_VALUE_HINT[b.type]}
                      value={b.value}
                      onChange={(e) =>
                        setButtons((p) =>
                          p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={buttons.length === 1}
                  onClick={() => setButtons((p) => p.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {buttons.length < 3 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setButtons((p) => [...p, { type: "reply", text: "", value: "" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Botão
              </Button>
            )}
          </TabsContent>

          <TabsContent value="list" className="space-y-2">
            <div>
              <Label className="text-xs">Texto do botão que abre a lista</Label>
              <Input
                value={buttonText}
                maxLength={20}
                onChange={(e) => setButtonText(e.target.value)}
              />
            </div>
            <Label className="text-xs">Opções (máx. 10)</Label>
            {rows.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
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
                  disabled={rows.length === 1}
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
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
                <Plus className="mr-1 h-3.5 w-3.5" /> Opção
              </Button>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSend || busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2, Upload, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAccount } from "@/lib/account-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bulkSalesReps,
  createSalesRep,
  deleteSalesRep,
  listSalesRepPendencias,
  listSalesReps,
  parseSalesRepsText,
  updateSalesRep,
  type Departamento,
  type PendenciaReason,
  type SalesRep,
  type SalesRepPendencia,
} from "@/lib/sales-reps";

const DEPARTAMENTO_LABEL: Record<Departamento, string> = {
  COMERCIAL: "Comercial",
  FINANCEIRO: "Financeiro",
};

export const Route = createFileRoute("/_authenticated/vendedores")({
  head: () => ({
    meta: [
      { title: "Vendedores — Utalks" },
      {
        name: "description",
        content: "Cadastro de vendedores e telefones usados na transferência das ligações da IA.",
      },
    ],
  }),
  component: VendedoresPage,
});

const REASON_LABEL: Record<PendenciaReason, string> = {
  sem_cadastro: "Sem cadastro",
  sem_telefone: "Sem telefone",
  sem_vendedor: "Lead sem vendedor",
  sem_atendente_padrao: "Sem atendente padrão do departamento",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function fmtPhone(e164: string | null): string {
  if (!e164) return "—";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}

interface FormState {
  id: string | null;
  nome: string;
  aliases: string;
  phone: string;
  email: string;
  active: boolean;
  departamento: Departamento;
  isDefault: boolean;
  nomeFalado: string;
}

const emptyForm: FormState = {
  id: null,
  nome: "",
  aliases: "",
  phone: "",
  email: "",
  active: true,
  departamento: "COMERCIAL",
  isDefault: false,
  nomeFalado: "",
};

function VendedoresPage() {
  const { accountId } = useAccount();
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [pendencias, setPendencias] = useState<SalesRepPendencia[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<SalesRep | null>(null);

  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [r, p] = await Promise.all([listSalesReps(accountId), listSalesRepPendencias(accountId)]);
      setReps(r);
      setPendencias(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar vendedores");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  function formFromRep(r: SalesRep): FormState {
    return {
      id: r.id,
      nome: r.nome,
      aliases: r.aliases.join(", "),
      phone: r.phone_e164 ?? "",
      email: r.email ?? "",
      active: r.active,
      departamento: r.departamento,
      isDefault: r.is_default,
      nomeFalado: r.nome_falado ?? "",
    };
  }

  function openFromRep(r: SalesRep) {
    setForm(formFromRep(r));
  }

  /** Pendência "sem telefone" já tem cadastro: edita o existente; "sem cadastro" abre novo preenchido. */
  function openFromPendencia(p: SalesRepPendencia) {
    if (p.reason === "sem_atendente_padrao") {
      // Sem vendedor_key específico — ou marca um cadastro existente do
      // departamento como padrão, ou abre um novo já configurado como tal.
      const existingInDept = reps.find((r) => r.departamento === p.departamento);
      setForm(
        existingInDept
          ? { ...emptyForm, ...formFromRep(existingInDept), isDefault: true }
          : {
              ...emptyForm,
              nome: p.departamento === "FINANCEIRO" ? "Setor Financeiro" : "Central Comercial",
              departamento: p.departamento,
              isDefault: true,
            },
      );
      return;
    }
    const existing = reps.find((r) => p.vendedor_key && r.nome && matchesKey(r, p.vendedor_key));
    if (existing) return openFromRep(existing);
    const nome = p.vendedor_nome ?? "";
    setForm({ ...emptyForm, nome: titleCase(nome), aliases: nome });
  }

  async function handleSave() {
    if (!accountId || !form) return;
    if (form.nome.trim().length < 2) {
      toast.error("Informe o nome do vendedor");
      return;
    }
    if (form.isDefault && !form.phone.trim()) {
      toast.error("Atendente padrão precisa de telefone");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        active: form.active,
        departamento: form.departamento,
        isDefault: form.isDefault,
        nomeFalado: form.nomeFalado.trim() || null,
      };
      if (form.id) await updateSalesRep(accountId, form.id, payload);
      else await createSalesRep(accountId, payload);
      toast.success("Vendedor salvo");
      setForm(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar vendedor");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!accountId || !toDelete) return;
    try {
      await deleteSalesRep(accountId, toDelete.id);
      toast.success("Vendedor removido");
      setToDelete(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover vendedor");
    }
  }

  async function handleImport() {
    if (!accountId) return;
    const items = parseSalesRepsText(importText);
    if (items.length === 0) {
      toast.error("Nenhuma linha válida. Formato: nome ; telefone ; email ; aliases (separados por |)");
      return;
    }
    setImportBusy(true);
    try {
      const res = await bulkSalesReps(accountId, items);
      if (res.errors.length > 0) {
        toast.warning(
          `${res.created} criados, ${res.updated} atualizados. Erros: ${res.errors
            .map((e) => `${e.nome} (${e.error})`)
            .join("; ")}`,
        );
      } else {
        toast.success(`${res.created} criados, ${res.updated} atualizados`);
      }
      setImporting(false);
      setImportText("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na importação");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configuração"
        title="Vendedores"
        description="Telefone de cada vendedor para a IA transferir a ligação ao responsável do lead. Sem cadastro, a ligação cai no número central da campanha."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <Upload className="mr-2 h-4 w-4" /> Importar
            </Button>
            <Button size="sm" onClick={() => setForm(emptyForm)}>
              <Plus className="mr-2 h-4 w-4" /> Novo vendedor
            </Button>
          </>
        }
      />

      <div className="px-6 py-6">
        <Tabs defaultValue="pendencias">
          <TabsList>
            <TabsTrigger value="pendencias">
              Pendências
              {pendencias.length > 0 && (
                <Badge variant="destructive" className="ml-2 px-1.5 py-0 text-[10px]">
                  {pendencias.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="equipe">Equipe ({reps.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pendencias" className="mt-4">
            {loading ? (
              <Loading />
            ) : pendencias.length === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="Nenhuma pendência"
                description="Todos os vendedores dos leads discados têm cadastro com telefone."
              />
            ) : (
              <div className="glass overflow-hidden rounded-xl">
                <div className="flex items-start gap-2 border-b border-gray-200 dark:border-slate-800 px-4 py-3 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  Estes vendedores apareceram em leads discados mas não têm telefone cadastrado. As ligações foram
                  transferidas para o número central. Cadastrar com telefone resolve a pendência automaticamente.
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor (como veio do ERP)</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Ligações</TableHead>
                      <TableHead>Última vez</TableHead>
                      <TableHead>Caiu em</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendencias.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.vendedor_nome || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{REASON_LABEL[p.reason]}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.occurrences}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDateTime(p.last_seen_at)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.campaign_id ? (
                            <Link
                              to="/campanhas/$campaignId"
                              params={{ campaignId: p.campaign_id }}
                              className="text-primary hover:underline"
                            >
                              {fmtPhone(p.fallback_number)}
                            </Link>
                          ) : (
                            fmtPhone(p.fallback_number)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.reason !== "sem_vendedor" && (
                            <Button size="sm" variant="outline" onClick={() => openFromPendencia(p)}>
                              {p.reason === "sem_telefone"
                                ? "Adicionar telefone"
                                : p.reason === "sem_atendente_padrao"
                                  ? "Definir padrão"
                                  : "Cadastrar"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="equipe" className="mt-4">
            {loading ? (
              <Loading />
            ) : reps.length === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="Nenhum vendedor cadastrado"
                description="Cadastre ou importe a equipe comercial para a IA transferir cada lead ao vendedor certo."
                action={<Button onClick={() => setForm(emptyForm)}>Novo vendedor</Button>}
              />
            ) : (
              <div className="glass overflow-hidden rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Departamento</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Grafias do ERP</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reps.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.nome}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline">{DEPARTAMENTO_LABEL[r.departamento]}</Badge>
                            {r.is_default && <Badge>Padrão</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {r.phone_e164 ? (
                            fmtPhone(r.phone_e164)
                          ) : (
                            <Badge variant="outline" className="text-amber-600">Sem telefone</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">
                          {r.aliases.join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Ativo" : "Inativo"}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => openFromRep(r)} aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setToDelete(r)} aria-label="Remover">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar vendedor" : "Novo vendedor"}</DialogTitle>
            <DialogDescription>
              O telefone recebe a ligação transferida. As grafias ajudam a casar o nome que vem do ERP.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Departamento</Label>
                <Select
                  value={form.departamento}
                  onValueChange={(v) => setForm({ ...form, departamento: v as Departamento })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COMERCIAL">Comercial</SelectItem>
                    <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Telefone (com DDD)</Label>
                <Input
                  placeholder="(41) 3512-0638"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Grafias do ERP (separadas por vírgula)</Label>
                <Input
                  placeholder="JAIME JONAS DA ROCHA, Jaime"
                  value={form.aliases}
                  onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Como a IA cita (opcional)</Label>
                <Input
                  placeholder='Ex.: "nossa central de atendimento comercial"'
                  value={form.nomeFalado}
                  onChange={(e) => setForm({ ...form, nomeFalado: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <Label>Ativo</Label>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.isDefault}
                    onCheckedChange={(v) => setForm({ ...form, isDefault: v })}
                  />
                  <Label>Atendente padrão do departamento</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recebe a transferência quando o lead não tem vendedor específico cadastrado
                  (ou, no Financeiro, sempre — cobrança nunca transborda para o comercial).
                  Só um padrão ativo por departamento.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar vendedores</DialogTitle>
            <DialogDescription>
              Uma linha por vendedor: <code>nome ; telefone ; email ; aliases</code> (aliases separados por{" "}
              <code>|</code>). Quem já existe (mesmo nome) é atualizado.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            placeholder={"Soraya Caponi ; (41) 3512-0657 ; comercial01@ubva.com.br ; SORAYA CAPONI|Soraya"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={importBusy}>
              {importBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {toDelete?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads desse vendedor passam a cair no número central da campanha até um novo cadastro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

/** Mesma normalização do backend (sales-reps.util.ts) — só para achar o cadastro existente. */
function normKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesKey(r: SalesRep, key: string): boolean {
  return [r.nome, ...r.aliases].some((n) => normKey(n) === key);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

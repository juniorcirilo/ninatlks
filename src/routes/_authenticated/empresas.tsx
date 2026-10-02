import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Search, Upload, Plus, Pencil, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, paginate, TablePagination } from "@/components/layout/TableFilters";
import { useAccount } from "@/lib/account-context";
import {
  listCompanies,
  listCompanyContacts,
  listClientCompanies,
  linkClientCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  deleteAllCompanies,
  fetchTeam,
  bulkLinkClientCompaniesCsv,
  type CompanyListRow,
  type ClientCompanyRow,
  type TeamLite,
  type LinkClientCompaniesResult,
} from "@/lib/central";

export const Route = createFileRoute("/_authenticated/empresas")({
  head: () => ({
    meta: [
      { title: "Empresas — Nina Talks" },
      {
        name: "description",
        content: "Empresas vinculadas a clientes — cadastro por empresa_id, razão social, nome fantasia e vendedor.",
      },
    ],
  }),
  component: EmpresasPage,
});

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

function EmpresasPage() {
  const { accountId } = useAccount();

  const [companies, setCompanies] = useState<CompanyListRow[]>([]);
  const [team, setTeam] = useState<TeamLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Editar empresa existente.
  const [editing, setEditing] = useState<CompanyListRow | null>(null);
  const [editContacts, setEditContacts] = useState<{ id: string; name: string | null; phone_number: string | null }[]>([]);
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [vendedorId, setVendedorId] = useState("__none");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Nova empresa — por padrão nasce escolhendo um cliente primeiro; "Só
  // empresa" cadastra direto por id/nome, pra vincular a cliente(s) depois
  // (import ou sync casam por empresa_id automaticamente).
  const [creating, setCreating] = useState(false);
  const [noClientMode, setNoClientMode] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientOptions, setClientOptions] = useState<ClientCompanyRow[]>([]);
  const [pickedClient, setPickedClient] = useState<ClientCompanyRow | null>(null);
  const [newExternalId, setNewExternalId] = useState("");
  const [newName, setNewName] = useState("");

  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<LinkClientCompaniesResult | null>(null);

  const [confirmTruncate, setConfirmTruncate] = useState(false);
  const [truncating, setTruncating] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const rows = await listCompanies(accountId, search);
      setCompanies(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar empresas");
    } finally {
      setLoading(false);
    }
  }, [accountId, search]);

  useEffect(() => {
    if (!accountId) return;
    fetchTeam(accountId).then(setTeam).catch(() => {});
  }, [accountId]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const pagination = usePagination(companies.length);
  // Busca muda o conjunto (server-side) — volta pra página 1 pra não deixar
  // o operador "preso" numa página que não existe mais no resultado novo.
  useEffect(() => {
    pagination.setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);
  const paged = paginate(companies, pagination.start, pagination.pageSize);

  useEffect(() => {
    if (!accountId || !creating) return;
    const t = setTimeout(() => {
      listClientCompanies(accountId, clientSearch).then(setClientOptions).catch(() => {});
    }, clientSearch ? 300 : 0);
    return () => clearTimeout(t);
  }, [accountId, creating, clientSearch]);

  function openCreate() {
    setNoClientMode(false);
    setPickedClient(null);
    setClientSearch("");
    setClientOptions([]);
    setNewExternalId("");
    setNewName("");
    setCreating(true);
  }

  async function openEdit(c: CompanyListRow) {
    setEditing(c);
    setRazaoSocial(c.razao_social ?? "");
    setNomeFantasia(c.nome_fantasia ?? "");
    setVendedorId(c.vendedor_id ?? "__none");
    if (accountId) {
      try {
        setEditContacts(await listCompanyContacts(accountId, c.id));
      } catch {
        setEditContacts([]);
      }
    }
  }

  async function handleCreate() {
    if (!accountId) return;
    if (!noClientMode && !pickedClient) return;
    setSaving(true);
    try {
      if (noClientMode) {
        // Só empresa (id, nome) — sem cliente vinculado ainda. Clientes
        // casam com ela depois por empresa_id, na importação ou no sync.
        await createCompany(accountId, {
          externalId: newExternalId.trim() || null,
          name: newName.trim() || null,
        });
      } else {
        await linkClientCompany(accountId, {
          contactId: pickedClient!.contact_id,
          externalId: newExternalId.trim() || undefined,
          name: newName.trim() || undefined,
        });
      }
      toast.success("Empresa cadastrada");
      setCreating(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cadastrar empresa");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!accountId || !editing) return;
    setSaving(true);
    try {
      await updateCompany(accountId, editing.id, {
        razao_social: razaoSocial.trim() || null,
        nome_fantasia: nomeFantasia.trim() || null,
        vendedor_id: vendedorId === "__none" ? null : vendedorId,
      });
      toast.success("Empresa atualizada");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar empresa");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!accountId || !editing) return;
    setDeleting(true);
    try {
      await deleteCompany(accountId, editing.id);
      toast.success("Empresa excluída");
      setConfirmDelete(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir empresa");
    } finally {
      setDeleting(false);
    }
  }

  async function handleImport() {
    if (!accountId || !importFile) return;
    setImportBusy(true);
    try {
      const text = await importFile.text();
      const result = await bulkLinkClientCompaniesCsv(accountId, text);
      setImportResult(result);
      if (result.linked > 0) {
        toast.success(`${result.linked} cliente(s) vinculado(s), ${result.created} empresa(s) nova(s).`);
        load();
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} linha(s) com erro — veja o resumo.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar planilha");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleTruncate() {
    if (!accountId) return;
    setTruncating(true);
    try {
      const { deleted } = await deleteAllCompanies(accountId);
      toast.success(`${deleted} empresa(s) removida(s).`);
      setConfirmTruncate(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao truncar empresas");
    } finally {
      setTruncating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cadastros"
        title="Empresas"
        description="Toda empresa nasce vinculada a um cliente — escolha o cliente e use empresa_id (código do ERP) pra achar ou criar a empresa certa."
        actions={
          <>
            <Button
              variant="outline"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirmTruncate(true)}
              disabled={companies.length === 0}
            >
              <Trash2 className="h-4 w-4" />
              Truncar
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" />
              Importar
            </Button>
            <Button className="gap-1.5" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nova empresa
            </Button>
          </>
        }
      />

      <div className="space-y-4 px-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, razão social ou código…"
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Nenhuma empresa cadastrada"
            description="Escolha um cliente e cadastre a empresa dele — por empresa_id (código do ERP) ou avulsa."
            action={
              <Button className="gap-1.5" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nova empresa
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Código (empresa_id)</TableHead>
                  <TableHead>Clientes</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.external_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.linked_contacts_count}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-4">
              <TablePagination
                itemCount={companies.length}
                itemLabel="empresas"
                page={pagination.page}
                pageCount={pagination.pageCount}
                onPageChange={pagination.setPage}
                pageSize={pagination.pageSize}
                onPageSizeChange={(n) => {
                  pagination.setPageSize(n);
                  pagination.setPage(1);
                }}
                start={pagination.start}
                end={pagination.end}
              />
            </div>
          </div>
        )}
      </div>

      {/* Nova empresa — a partir de um cliente, ou só id/nome (sem cliente ainda). */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>
              {noClientMode
                ? "Cadastra só a empresa (empresa_id + nome) — clientes vinculam depois, automaticamente, por empresa_id."
                : "Escolha o cliente dono desta empresa, depois informe o empresa_id (acha ou cria) ou um nome pra empresa avulsa."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1.5 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-1">
            <Button
              type="button"
              variant={noClientMode ? "ghost" : "secondary"}
              size="sm"
              className="flex-1"
              onClick={() => setNoClientMode(false)}
            >
              A partir de um cliente
            </Button>
            <Button
              type="button"
              variant={noClientMode ? "secondary" : "ghost"}
              size="sm"
              className="flex-1"
              onClick={() => setNoClientMode(true)}
            >
              Só empresa (id, nome)
            </Button>
          </div>
          <div className="space-y-3 py-2">
            {noClientMode ? null : pickedClient ? (
              <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{pickedClient.contact_name ?? "(sem nome)"}</p>
                  <p className="text-xs text-muted-foreground">{pickedClient.phone_number ?? "—"}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setPickedClient(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div>
                <Label className="mb-1 block text-xs">Cliente</Label>
                <Input
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone…"
                />
                <div className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {clientOptions.map((c) => (
                    <button
                      key={c.contact_id}
                      type="button"
                      onClick={() => setPickedClient(c)}
                      className="block w-full rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-border hover:bg-muted/40"
                    >
                      <span className="font-medium text-foreground">{c.contact_name ?? "(sem nome)"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{c.phone_number}</span>
                      {c.company_name && (
                        <span className="ml-2 text-xs text-muted-foreground">— já tem: {c.company_name}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(noClientMode || pickedClient) && (
              <>
                <div>
                  <Label className="mb-1 block text-xs">Código de origem (empresa_id)</Label>
                  <Input
                    value={newExternalId}
                    onChange={(e) => setNewExternalId(e.target.value)}
                    placeholder="Ex.: 1 — acha ou cria a empresa"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">
                    Nome da empresa {newExternalId.trim() ? "(opcional)" : ""}
                  </Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={newExternalId.trim() ? "Ex.: Empresa 1 — usa \"Empresa <código>\" se vazio" : "Obrigatório sem empresa_id"}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                saving ||
                (!noClientMode && !pickedClient) ||
                (!newExternalId.trim() && !newName.trim())
              }
              className="gap-1.5"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar empresa existente. */}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar empresa</DialogTitle>
            <DialogDescription>
              {editing?.external_id ? `Código: ${editing.external_id}` : "Empresa avulsa, sem empresa_id."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="mb-1 block text-xs">Razão social</Label>
              <Input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Nome fantasia</Label>
              <Input value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Vendedor</Label>
              <Select value={vendedorId} onValueChange={setVendedorId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sem vendedor</SelectItem>
                  {team.map((t) => (
                    <SelectItem key={t.user_id} value={t.user_id}>
                      {t.name ?? t.email ?? t.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">
                Clientes vinculados ({editContacts.length})
              </Label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-2">
                {editContacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum cliente vinculado.</p>
                ) : (
                  editContacts.map((ct) => (
                    <p key={ct.id} className="text-xs text-foreground">
                      {ct.name ?? "(sem nome)"}{" "}
                      <span className="text-muted-foreground">{ct.phone_number}</span>
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              <Trash2 className="h-4 w-4" />
              Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSaveEdit} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{editing?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {editing?.linked_contacts_count
                ? `${editing.linked_contacts_count} cliente(s) vinculado(s) ficam sem empresa — o cliente em si não é apagado.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar todas as {companies.length} empresa(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os clientes vinculados ficam sem empresa (o cliente em si não é apagado). Não
              dá pra desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={truncating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleTruncate();
              }}
              disabled={truncating}
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {truncating && <Loader2 className="h-4 w-4 animate-spin" />}
              Truncar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={importing}
        onOpenChange={(o) => {
          if (!o) {
            setImporting(false);
            setImportFile(null);
            setImportResult(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar vínculos cliente → empresa</DialogTitle>
            <DialogDescription>
              Planilha CSV com <code className="font-mono">telefone</code> (chave do cliente,
              obrigatória) e <code className="font-mono">empresa_id</code> (acha ou cria a
              empresa) — <code className="font-mono">nome</code> é opcional, usado só quando não
              há empresa_id.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] ?? null);
                setImportResult(null);
              }}
              className="block w-full text-xs"
            />
            {importResult && (
              <div className="rounded-md border border-gray-200 dark:border-slate-800 bg-muted/30 p-3 text-xs">
                <p className="text-foreground">
                  {importResult.linked} cliente(s) vinculado(s) · {importResult.created} empresa(s) nova(s)
                  {importResult.errors.length > 0 && ` · ${importResult.errors.length} erro(s)`}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-muted-foreground">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>
                        Linha {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImporting(false);
                setImportFile(null);
                setImportResult(null);
              }}
            >
              Fechar
            </Button>
            <Button onClick={handleImport} disabled={!importFile || importBusy} className="gap-1.5">
              {importBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

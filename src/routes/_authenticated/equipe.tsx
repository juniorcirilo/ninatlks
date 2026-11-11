import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Users,
  Mail,
  Loader2,
  Copy,
  Check,
  Trash2,
  ShieldCheck,
  UserCog,
  Pencil,
  KeyRound,
  Wand2,
  Send,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAccount } from "@/lib/account-context";
import { useAuth } from "@/lib/auth-context";
import {
  listTeamMembers,
  listInvites,
  createInvite,
  revokeInvite,
  changeMemberRole,
  removeMember,
  updateMember,
  setMemberPassword,
  buildInviteUrl,
  type TeamMember,
  type Invite,
  type MemberRole,
} from "@/lib/team";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe — Utalks" },
      {
        name: "description",
        content: "Convide colaboradores e gerencie permissões do workspace.",
      },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { accountId, role, loading } = useAccount();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Não-admin → redireciona para o painel.
  useEffect(() => {
    if (!loading && role !== "admin") {
      toast.error("Apenas administradores podem gerenciar a equipe.");
      navigate({ to: "/", replace: true });
    }
  }, [loading, role, navigate]);

  if (loading || !accountId || role !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Workspace"
        title="Equipe"
        description="Convide colaboradores e gerencie quem tem acesso a este workspace."
      />
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
        <MembersCard accountId={accountId} currentUserId={user?.id ?? null} />
        <InvitesCard accountId={accountId} />
      </div>
    </div>
  );
}

/* ───────────────── Membros ───────────────── */

function MembersCard({
  accountId,
  currentUserId,
}: {
  accountId: string;
  currentUserId: string | null;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setMembers(await listTeamMembers(accountId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar equipe.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const handleRoleChange = async (m: TeamMember, newRole: MemberRole) => {
    if (m.role === newRole) return;
    setBusyId(m.user_id);
    try {
      await changeMemberRole(accountId, m.user_id, newRole);
      toast.success(`${m.name} agora é ${newRole === "admin" ? "admin" : "agent"}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao mudar função.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (m: TeamMember) => {
    if (!confirm(`Remover ${m.name} (${m.email}) do workspace?`)) return;
    setBusyId(m.user_id);
    try {
      await removeMember(accountId, m.user_id);
      toast.success(`${m.name} removido(a).`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-cyan-400" />
        <h2 className="text-[14px] font-semibold">Membros ({members.length})</h2>
      </div>

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            const busy = busyId === m.user_id;
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{m.name}</span>
                    {isSelf && (
                      <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800 dark:text-cyan-200">
                        você
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={m.role}
                    disabled={busy || isSelf}
                    onValueChange={(v) => handleRoleChange(m, v as MemberRole)}
                  >
                    <SelectTrigger className="h-8 w-auto gap-1.5 bg-background px-2 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="agent">agent</SelectItem>
                    </SelectContent>
                  </Select>

                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    disabled={busy}
                    aria-label="Editar membro"
                    className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-30"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={busy || isSelf}
                    aria-label="Remover membro"
                    className={cn(
                      "rounded p-1.5 text-muted-foreground transition-colors",
                      "hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <EditMemberDialog
        accountId={accountId}
        member={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </section>
  );
}

function EditMemberDialog({
  accountId,
  member,
  onClose,
  onSaved,
}: {
  accountId: string;
  member: TeamMember | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(member?.name ?? "");
    setEmail(member?.email ?? "");
    setPassword("");
    setShownPassword(null);
    setCopied(false);
  }, [member]);

  if (!member) return null;

  const inputClass =
    "h-10 w-full rounded-md border border-gray-200 dark:border-slate-800 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  const handleSave = async () => {
    if (!name.trim() || !email.includes("@")) {
      toast.error("Informe nome e e-mail válidos.");
      return;
    }
    setSaving(true);
    try {
      await updateMember(accountId, member.user_id, { name, email });
      toast.success("Membro atualizado.");
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const applyPassword = async (custom?: string) => {
    if (custom !== undefined && custom.length < 8) {
      toast.error("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (!confirm(`Redefinir a senha de ${member.name}? Ele(a) será desconectado(a) de todos os dispositivos.`)) return;
    setPwBusy(true);
    try {
      const res = await setMemberPassword(accountId, member.user_id, custom);
      setShownPassword(res.password);
      setPassword("");
      setCopied(false);
      toast.success(res.generated ? "Senha gerada." : "Senha alterada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao alterar senha.");
    } finally {
      setPwBusy(false);
    }
  };

  const copyPassword = async () => {
    if (!shownPassword) return;
    try {
      await navigator.clipboard.writeText(shownPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não consegui copiar.");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar membro</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Nome</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-xs font-medium text-muted-foreground">E-mail</label>
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <KeyRound className="h-3.5 w-3.5" />
            Senha
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              autoComplete="off"
              placeholder="Nova senha (mín. 8 caracteres)"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              disabled={pwBusy || password.length === 0}
              onClick={() => applyPassword(password)}
              className="h-10 shrink-0 rounded-md border border-gray-200 dark:border-slate-800 bg-background px-3 text-xs font-medium hover:bg-foreground/[0.04] disabled:opacity-50"
            >
              Alterar
            </button>
          </div>
          <button
            type="button"
            disabled={pwBusy}
            onClick={() => applyPassword()}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            {pwBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Gerar senha aleatória
          </button>

          {shownPassword && (
            <div className="rounded-md border border-cyan-500/40 bg-cyan-500/10 p-2">
              <div className="flex gap-2">
                <input readOnly value={shownPassword} className={cn(inputClass, "h-9 font-mono text-xs")} />
                <button
                  type="button"
                  onClick={copyPassword}
                  className="flex h-9 items-center gap-1 rounded-md border border-gray-200 dark:border-slate-800 bg-background px-3 text-xs font-medium hover:bg-foreground/[0.04]"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Copie agora e repasse à pessoa: esta senha não será exibida novamente.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-gray-200 dark:border-slate-800 px-4 text-sm hover:bg-foreground/[0.04]"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────── Convites ───────────────── */

function InvitesCard({ accountId }: { accountId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("agent");
  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setInvites(await listInvites(accountId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar convites.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const pending = invites.filter(
    (i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date(),
  );

  const handleCreate = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error("E-mail inválido.");
      return;
    }
    setCreating(true);
    try {
      const inv = await createInvite(accountId, trimmed, role);
      setNewInvite(inv);
      setEmail("");
      setCopied(false);
      await load();
      toast.success("Convite criado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar convite.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não consegui copiar.");
    }
  };

  const handleRevoke = async (inv: Invite) => {
    if (!confirm(`Revogar o convite de ${inv.email}?`)) return;
    try {
      await revokeInvite(accountId, inv.id);
      toast.success("Convite revogado.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao revogar.");
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Mail className="h-4 w-4 text-sky-400" />
        <h2 className="text-[14px] font-semibold">Convidar colaborador</h2>
      </div>

      {/* Form */}
      <div className="space-y-2">
        <input
          type="email"
          placeholder="email@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 w-full rounded-md border border-gray-200 dark:border-slate-800 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <div className="flex gap-2">
          <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
            <SelectTrigger className="h-10 w-auto gap-1.5 bg-background px-2 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">agent (padrão)</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Gerar convite
          </button>
        </div>
      </div>

      {/* Banner com link recém-criado */}
      {newInvite && (
        <div className="mt-4 rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-800 dark:text-cyan-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Convite gerado para {newInvite.email} · {newInvite.role}
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              value={buildInviteUrl(newInvite.token)}
              className="h-9 flex-1 rounded-md border border-gray-200 dark:border-slate-800 bg-background px-2 text-xs text-foreground"
            />
            <button
              type="button"
              onClick={() => handleCopy(newInvite.token)}
              className="flex h-9 items-center gap-1 rounded-md border border-gray-200 dark:border-slate-800 bg-background px-3 text-xs font-medium text-foreground hover:bg-foreground/[0.04]"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Envie esse link à pessoa convidada. O link expira em 7 dias.
          </p>
        </div>
      )}

      {/* Pendentes */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <UserCog className="h-3.5 w-3.5" />
          Convites pendentes ({pending.length})
        </div>
        {loading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 dark:border-slate-800 p-3 text-center text-xs text-muted-foreground">
            Nenhum convite pendente.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-gray-200 dark:border-slate-800">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{inv.email}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {inv.role} · expira em {new Date(inv.expiresAt).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopy(inv.token)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                    aria-label="Copiar link"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                    aria-label="Revogar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-gray-200 dark:border-slate-800 bg-background/50 p-3 text-[11px] text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          O convidado precisa criar uma conta usando o link gerado. O e-mail informado é só uma
          referência — o que valida o convite é o token na URL.
        </p>
      </div>
    </section>
  );
}

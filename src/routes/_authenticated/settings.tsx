import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Check, Loader2, KeyRound, PhoneCall, UserPlus, Lock, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccount } from "@/lib/account-context";
import {
  ensureWebhookSecret,
  fetchAccount,
  updateAccountSettings,
  fetchDialingSettings,
  updateDialingSettings,
  DEFAULT_DIALING_SETTINGS,
  type DialingSettings,
  type DayKey,
} from "@/lib/settings";
import { advanceOnboardingStep, reopenOnboarding } from "@/lib/onboarding";
import { WebhookDeliveriesPanel } from "@/components/settings/WebhookDeliveriesPanel";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Configurações — Nina Talks" },
      {
        name: "description",
        content: "Integrações, dados da empresa e webhooks.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Ajustes"
        title="Configurações"
        description="Dados da empresa, integrações e chaves de acesso."
      />
      <div className="px-6 py-6">
        <Tabs defaultValue="integrations" className="w-full">
          <TabsList className="mb-4 bg-white/[0.04]">
            <TabsTrigger value="integrations">Integrações</TabsTrigger>
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="dialing">Discagem</TabsTrigger>
            <TabsTrigger value="account">Conta & Equipe</TabsTrigger>
            <TabsTrigger value="api-keys">Chaves de acesso</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>
          <TabsContent value="integrations">
            <IntegrationsTab />
          </TabsContent>
          <TabsContent value="general">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="dialing">
            <DialingTab />
          </TabsContent>
          <TabsContent value="account">
            <AccountTab />
          </TabsContent>
          <TabsContent value="api-keys">
            <ApiKeysTab />
          </TabsContent>
          <TabsContent value="webhooks">
            <WebhooksTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ───────────────── Conta & Equipe ───────────────── */

function AccountTab() {
  const { user } = useAuth();
  const { role } = useAccount();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }
    if (!user?.email) {
      toast.error("Sessão inválida.");
      return;
    }
    setChanging(true);
    try {
      // Reautentica com a senha atual antes de trocar.
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signErr) {
        toast.error("Senha atual incorreta.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Senha atualizada com sucesso.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setChanging(false);
    }
  };

  const handleSendResetLink = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Enviamos um link de redefinição para ${user.email}.`);
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Alterar minha senha" desc="Informe sua senha atual e a nova senha.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Senha atual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Nova senha</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
              autoComplete="new-password"
            />
          </div>
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={changing || !currentPassword || !newPassword}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Atualizar senha
          </button>
          <button
            type="button"
            onClick={handleSendResetLink}
            disabled={sendingReset}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-background text-xs font-medium text-foreground hover:bg-white/[0.04] disabled:opacity-50"
          >
            {sendingReset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            Ou enviar link de redefinição para meu e-mail
          </button>
        </div>
      </Card>

      <Card
        title="Equipe & convites"
        desc={
          role === "admin"
            ? "Convide novos usuários e gerencie permissões do workspace."
            : "Apenas administradores podem convidar novos usuários."
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-md border border-border bg-background/50 p-3 text-xs text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
            <p>
              Para adicionar um novo usuário à plataforma, gere um link de convite
              em <strong className="text-foreground">Equipe</strong>. A pessoa cria
              a própria conta usando o link e já entra com a permissão escolhida
              (admin ou agent).
            </p>
          </div>
          {role === "admin" ? (
            <Link
              to="/equipe"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <UserPlus className="h-4 w-4" />
              Gerenciar equipe e convites
            </Link>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Peça a um administrador para te dar acesso ou enviar convites.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Card({ children, title, desc }: { children: React.ReactNode; title: string; desc?: string }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {desc && <p className="mt-1 text-[12px] text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function GeneralTab() {
  const { accountId } = useAccount();
  const [name, setName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchAccount(accountId)
      .then((acct) => {
        setName(acct.name ?? "");
        setSupportEmail(acct.support_email ?? "");
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  const save = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      await updateAccountSettings(accountId, { name, support_email: supportEmail });
      await advanceOnboardingStep(accountId, "empresa", { name, support_email: supportEmail }).catch(() => {});
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error("Não conseguimos salvar. Verifique os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card title="Organização" desc="Nome da empresa cobradora e e-mail de suporte.">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Nome da empresa
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            E-mail de suporte
          </label>
          <input
            type="email"
            value={supportEmail}
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="suporte@empresa.com"
            className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Salvar
        </button>
      </div>
      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <h3 className="text-[13px] font-semibold">Configuração inicial</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Reabra o assistente de onboarding para revisar empresa, chaves de
          provedores (ElevenLabs, Twilio, Deepgram, Evolution), agente e
          primeiro número.
        </p>
        <button
          onClick={async () => {
            if (!accountId) return;
            try {
              await reopenOnboarding(accountId);
              toast.success("Wizard reaberto. Recarregando…");
              setTimeout(() => window.location.reload(), 600);
            } catch (e: any) {
              toast.error(e?.message ?? "Falha ao reabrir o wizard.");
            }
          }}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[12px] font-semibold transition-colors hover:bg-white/[0.08]"
        >
          Reabrir wizard de onboarding
        </button>
      </div>
    </Card>
  );
}

// ============================================================
// Dialing window settings
// ============================================================

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
  sun: "Domingo",
};

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function DialingTab() {
  const { accountId } = useAccount();
  const [settings, setSettings] = useState<DialingSettings>(DEFAULT_DIALING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchDialingSettings(accountId)
      .then(setSettings)
      .catch(() => toast.error("Não foi possível carregar a configuração."))
      .finally(() => setLoading(false));
  }, [accountId]);

  const toggleDay = (day: DayKey, enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      allowed_hours_local: {
        ...prev.allowed_hours_local,
        [day]: enabled ? [9, 18] : null,
      },
    }));
  };

  const setHour = (day: DayKey, idx: 0 | 1, value: number) => {
    setSettings((prev) => {
      const cur = prev.allowed_hours_local[day];
      if (!cur) return prev;
      const next: [number, number] = [...cur] as [number, number];
      next[idx] = value;
      return {
        ...prev,
        allowed_hours_local: { ...prev.allowed_hours_local, [day]: next },
      };
    });
  };

  const save = async () => {
    if (!accountId) return;
    // validação básica: end > start
    for (const d of DAY_ORDER) {
      const r = settings.allowed_hours_local[d];
      if (r && r[1] <= r[0]) {
        toast.error(`${DAY_LABELS[d]}: hora final deve ser maior que a inicial.`);
        return;
      }
    }
    setSaving(true);
    try {
      await updateDialingSettings(accountId, settings);
      toast.success("Janela de discagem salva.");
    } catch {
      toast.error("Não conseguimos salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title="Janela de discagem"
        desc="Quando o sistema pode disparar ligações outbound. Fora desta janela, qualquer ligação (manual ou em campanha) é bloqueada."
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Fuso horário
            </label>
            <input
              value={settings.timezone}
              onChange={(e) => setSettings((p) => ({ ...p, timezone: e.target.value }))}
              className="w-full max-w-xs rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="America/Sao_Paulo"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-muted-foreground">
              Dias e horários permitidos
            </label>
            {DAY_ORDER.map((day) => {
              const range = settings.allowed_hours_local[day];
              const enabled = range !== null;
              return (
                <div
                  key={day}
                  className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <label className="flex w-32 items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleDay(day, e.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {DAY_LABELS[day]}
                  </label>
                  {enabled && range ? (
                    <div className="flex items-center gap-2 text-[12px]">
                      <HourInput
                        value={range[0]}
                        onChange={(v) => setHour(day, 0, v)}
                      />
                      <span className="text-muted-foreground">até</span>
                      <HourInput
                        value={range[1]}
                        onChange={(v) => setHour(day, 1, v)}
                      />
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      Sem ligações
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Máx. tentativas por dia (mesmo número)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.max_attempts_per_day}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    max_attempts_per_day: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Intervalo mínimo entre tentativas (min)
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={settings.min_minutes_between_attempts}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    min_minutes_between_attempts: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </button>
            <button
              onClick={() => setSettings(DEFAULT_DIALING_SETTINGS)}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Restaurar padrão
            </button>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PhoneCall className="h-3 w-3" />
              Aplica-se a campanhas e ligações manuais
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function HourInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
    >
      {Array.from({ length: 25 }, (_, i) => i).map((h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}

type ProviderField = { key: string; label: string; placeholder?: string; type?: "text" | "password" };
type ProviderDef = {
  provider: string;
  name: string;
  desc: string;
  required: boolean;
  fields: ProviderField[];
};

const INTEGRATION_PROVIDERS: ProviderDef[] = [
  {
    provider: "elevenlabs",
    name: "ElevenLabs",
    desc: "Voz neural para o agente Nina (TTS + agentes conversacionais).",
    required: true,
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "sk_..." },
    ],
  },
  {
    provider: "twilio",
    name: "Twilio",
    desc: "Telefonia (atende inbound e dispara follow-ups outbound).",
    required: true,
    fields: [
      { key: "account_sid", label: "Account SID", type: "text", placeholder: "AC..." },
      { key: "auth_token", label: "Auth Token", type: "password" },
    ],
  },
  {
    provider: "evolution",
    name: "Evolution (WhatsApp)",
    desc: "Follow-up por WhatsApp em cadências configuradas.",
    required: false,
    fields: [
      { key: "api_url", label: "API URL", type: "text", placeholder: "https://..." },
      { key: "api_key", label: "API Key", type: "password" },
    ],
  },
];

function ApiKeysTab() {
  const { accountId } = useAccount();
  const [secrets, setSecrets] = useState<Array<{ provider: string; key_name: string; updated_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProviderDef | null>(null);

  const reload = async () => {
    if (!accountId) return;
    setLoading(true);
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.rpc("list_account_secrets", { p_account_id: accountId });
    if (error) {
      toast.error("Não foi possível carregar as chaves");
      setLoading(false);
      return;
    }
    setSecrets((data as Array<{ provider: string; key_name: string; updated_at: string }>) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const isProviderConfigured = (p: ProviderDef) =>
    p.fields.every((f) => secrets.some((s) => s.provider === p.provider && s.key_name === f.key));

  const lastUpdated = (p: ProviderDef) => {
    const matched = secrets.filter((s) => s.provider === p.provider);
    if (matched.length === 0) return null;
    return matched.map((s) => s.updated_at).sort().slice(-1)[0];
  };

  return (
    <div className="space-y-4">
      <Card
        title="Integrações"
        desc="Configure suas chaves diretamente aqui. Os valores são criptografados e visíveis apenas para administradores deste workspace."
      >
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-2">
            {INTEGRATION_PROVIDERS.map((p) => {
              const configured = isProviderConfigured(p);
              const updated = lastUpdated(p);
              return (
                <div
                  key={p.provider}
                  className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-start gap-3">
                    <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold">{p.name}</span>
                        {p.required && (
                          <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
                            Obrigatória
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</p>
                      {updated && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Atualizada em {new Date(updated).toLocaleString("pt-BR")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        configured
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-500/20 text-slate-400",
                      )}
                    >
                      {configured ? "Configurada" : "Não configurada"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium hover:bg-white/[0.08]"
                    >
                      {configured ? "Atualizar" : "Configurar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {editing && (
        <ProviderEditDialog
          provider={editing}
          accountId={accountId!}
          configured={isProviderConfigured(editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ProviderEditDialog({
  provider,
  accountId,
  configured,
  onClose,
  onSaved,
}: {
  provider: ProviderDef;
  accountId: string;
  configured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleSave = async () => {
    const filled = provider.fields.filter((f) => (values[f.key] ?? "").trim().length > 0);
    if (filled.length === 0) {
      toast.error("Preencha pelo menos um campo.");
      return;
    }
    setSaving(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      for (const field of filled) {
        const { error } = await supabase.rpc("set_account_secret", {
          p_account_id: accountId,
          p_provider: provider.provider,
          p_key_name: field.key,
          p_value: values[field.key].trim(),
          p_metadata: {},
        });
        if (error) throw error;
      }
      toast.success(`${provider.name} salvo com sucesso.`);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(`Remover todas as chaves de ${provider.name}?`)) return;
    setRemoving(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      for (const field of provider.fields) {
        await supabase.rpc("delete_account_secret", {
          p_account_id: accountId,
          p_provider: provider.provider,
          p_key_name: field.key,
        });
      }
      toast.success(`${provider.name} removido.`);
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao remover";
      toast.error(msg);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-white/[0.08] bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-[14px] font-semibold">{provider.name}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">{provider.desc}</p>
          {configured && (
            <p className="mt-2 text-[11px] text-amber-300">
              Já existe valor configurado. Preencha apenas os campos que quiser substituir.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {provider.fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {f.label}
              </label>
              <input
                type={f.type ?? "password"}
                placeholder={f.placeholder ?? (configured ? "•••••••• (deixe em branco para manter)" : "")}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <div>
            {configured && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing || saving}
                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
              >
                {removing ? "Removendo…" : "Remover"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || removing}
              className="rounded-md border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium hover:bg-white/[0.04] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || removing}
              className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebhooksTab() {
  const { accountId } = useAccount();
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    ensureWebhookSecret(accountId)
      .then(setSecret)
      .catch(() => toast.error("Não foi possível gerar o secret"))
      .finally(() => setLoading(false));
  }, [accountId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Webhook secret" desc="HMAC SHA-256 para assinar payloads enviados ao Nina Talks.">
        {secret && (
          <UrlField
            label="Webhook secret"
            value={secret}
            onCopy={() => copy(secret, "secret")}
            copied={copied === "secret"}
            mono
          />
        )}
      </Card>
      <Card title="Recebimentos recentes" desc="Histórico das últimas chamadas recebidas.">
        <WebhookDeliveriesPanel />
      </Card>
    </div>
  );
}

function UrlField({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1">
        <input
          readOnly
          value={value}
          className={cn(
            "flex-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] focus:outline-none",
            mono && "font-mono",
          )}
        />
        <button
          onClick={onCopy}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground"
          aria-label="Copiar"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

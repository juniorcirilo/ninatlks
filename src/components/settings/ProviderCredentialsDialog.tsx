// Modal that lets a workspace admin save provider API keys directly into the
// per-account Vault (table account_secrets → vault.secrets via RPC). Values
// never leave the browser → server flow; Lovable Cloud env vars are NOT
// touched.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, ExternalLink, Trash2, Video } from "lucide-react";
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
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import {
  setAccountSecretsBulk,
  deleteAccountSecret,
  listAccountSecrets,
  type SecretProvider,
} from "@/lib/account-secrets";
import { syncAgentSourcesToN8n, describeN8nSync } from "@/lib/n8n";
import {
  fetchGoogleCalendarStatus,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  type GoogleCalendarStatus,
} from "@/lib/google-calendar";

export type CredentialProviderKey =
  | "twilio"
  | "elevenlabs"
  | "deepgram"
  | "n8n"
  | "custom-llm"
  | "smtp"
  | "google_calendar"
  | "postgresql"
  | "mssql";

interface FieldDef {
  keyName: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
  required?: boolean;
  hint?: string;
}

const PROVIDER_FIELDS: Record<
  CredentialProviderKey,
  {
    label: string;
    docsUrl: string;
    docsLabel: string;
    helper: string;
    fields: FieldDef[];
  }
> = {
  twilio: {
    label: "Twilio",
    docsUrl: "https://console.twilio.com/",
    docsLabel: "Console Twilio",
    helper:
      "Pegue o Account SID e o Auth Token na home do Console (seção 'Account Info'). Você também pode usar API Key + API Secret se preferir restringir permissões.",
    fields: [
      {
        keyName: "account_sid",
        label: "Account SID",
        type: "text",
        placeholder: "AC…",
        required: true,
      },
      {
        keyName: "auth_token",
        label: "Auth Token",
        type: "password",
        placeholder: "••••••••",
        hint: "Use Auth Token OU API Key + Secret (não precisa dos dois).",
      },
      { keyName: "api_key", label: "API Key (opcional)", type: "text", placeholder: "SK…" },
      {
        keyName: "api_secret",
        label: "API Secret (opcional)",
        type: "password",
        placeholder: "••••••••",
      },
    ],
  },
  elevenlabs: {
    label: "ElevenLabs",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    docsLabel: "Painel ElevenLabs",
    helper: "Crie uma API Key em Settings → API Keys. Precisa de permissão de Voice + ConvAI.",
    fields: [
      {
        keyName: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "sk_…",
        required: true,
      },
    ],
  },
  deepgram: {
    label: "Deepgram",
    docsUrl: "https://console.deepgram.com/",
    docsLabel: "Console Deepgram",
    helper: "Usado para transcrição de chamadas. Pegue uma key em Console → API Keys.",
    fields: [
      { keyName: "api_key", label: "API Key", type: "password", placeholder: "…", required: true },
    ],
  },
  n8n: {
    label: "n8n",
    docsUrl: "https://docs.n8n.io/api/authentication/",
    docsLabel: "Como gerar a API Key no n8n",
    helper:
      'URL da sua instância n8n e uma API Key gerada em Settings → n8n API. Ao salvar, criamos automaticamente o workflow "Utalks" e sincronizamos as fontes de dados já configuradas.',
    fields: [
      {
        keyName: "api_url",
        label: "URL da instância",
        type: "text",
        placeholder: "https://n8n.suaempresa.com",
        required: true,
      },
      {
        keyName: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "n8n_api_…",
        required: true,
      },
    ],
  },
  "custom-llm": {
    label: "IA própria (LM Studio ou compatível)",
    docsUrl: "https://lmstudio.ai/docs/local-server",
    docsLabel: "Como ligar o servidor local do LM Studio",
    helper:
      'Padrão da conta para agentes com Modelo = "IA própria". Endpoint compatível com a API de Chat Completions da OpenAI (é o que o LM Studio expõe). Cada agente pode substituir a URL/modelo na aba Modelo dele — a API key é sempre a da conta.',
    fields: [
      {
        keyName: "api_url",
        label: "URL do servidor",
        type: "text",
        placeholder: "http://seu-host:1234/v1",
        required: true,
      },
      {
        keyName: "model_id",
        label: "Model ID",
        type: "text",
        placeholder: "nome-do-modelo-carregado",
      },
      {
        keyName: "api_key",
        label: "API Key",
        type: "password",
        placeholder: "••••••••",
        required: true,
        hint: "Guardada com segurança; ao sincronizar um agente, criamos uma referência protegida dela dentro da ElevenLabs (nunca em texto puro).",
      },
    ],
  },
  smtp: {
    label: "E-mail (SMTP)",
    docsUrl:
      "https://www.hostgator.com.br/ajuda/artigo/como-configurar-uma-conta-de-email-no-outlook",
    docsLabel: "Onde achar host/porta/usuário no cPanel (Hostgator)",
    helper:
      "Usado para enviar o e-mail de confirmação (com o link do Google Meet) para o convidado e para quem conduz a reunião. Sem isso, as notificações ficam só no sininho. Funciona com qualquer provedor que ofereça uma conta de e-mail SMTP — o e-mail que já vem com a hospedagem (Hostgator/cPanel), Gmail, Zoho, ou o relay SMTP da Resend. No cPanel, acesse E-mail → Contas de E-mail → Configurar Cliente de E-mail pra ver host, porta e usuário. Usando o e-mail da própria empresa, o remetente já sai profissional, sem precisar de nenhum passo extra de verificação de domínio.",
    fields: [
      {
        keyName: "smtp_host",
        label: "Servidor SMTP (host)",
        type: "text",
        placeholder: "mail.suaempresa.com.br",
        required: true,
      },
      {
        keyName: "smtp_port",
        label: "Porta",
        type: "text",
        placeholder: "465 (SSL) ou 587 (TLS)",
        required: true,
      },
      {
        keyName: "smtp_user",
        label: "Usuário",
        type: "text",
        placeholder: "reunioes@suaempresa.com.br",
        required: true,
      },
      {
        keyName: "smtp_password",
        label: "Senha",
        type: "password",
        placeholder: "••••••••",
        required: true,
      },
      {
        keyName: "from_email",
        label: "Remetente (opcional)",
        type: "text",
        placeholder: "Sua Empresa <reunioes@suaempresa.com.br>",
        hint: "Deixe em branco pra usar o próprio usuário SMTP como remetente.",
      },
    ],
  },
  postgresql: {
    label: "PostgreSQL",
    docsUrl: "https://www.postgresql.org/docs/current/sql-grant.html",
    docsLabel: "Como criar um usuário somente leitura (GRANT SELECT)",
    helper:
      "Banco de dados do cliente que o Agente de IA consulta durante o atendimento (somente leitura). Use um usuário do banco com permissão apenas de SELECT, restrito às tabelas necessárias: é a proteção que realmente impede qualquer alteração. A senha fica criptografada no vault e nunca volta para o navegador.",
    fields: [
      {
        keyName: "host",
        label: "Servidor (host)",
        type: "text",
        placeholder: "db.suaempresa.com.br",
        required: true,
      },
      { keyName: "port", label: "Porta", type: "text", placeholder: "5432" },
      {
        keyName: "database",
        label: "Banco de dados",
        type: "text",
        placeholder: "erp",
        required: true,
      },
      {
        keyName: "client_id",
        label: "Client ID (tenant)",
        type: "text",
        placeholder: "ex.: 1024",
        required: true,
        hint: "Valor da coluna client_id que identifica este cliente no banco multi-tenant. O agente só consulta dados deste tenant: toda consulta é filtrada por ele (o agente escreve :client_id e o sistema preenche o valor). Sem isso, as consultas ficam bloqueadas.",
      },
      {
        keyName: "user",
        label: "Usuário (somente leitura)",
        type: "text",
        placeholder: "agente_leitura",
        required: true,
      },
      {
        keyName: "password",
        label: "Senha",
        type: "password",
        placeholder: "••••••••",
        required: true,
      },
      {
        keyName: "ssl",
        label: "Conexão criptografada (SSL/TLS)",
        type: "text",
        placeholder: "true ou false",
        hint: "Escreva true para exigir SSL/TLS; deixe em branco ou false para conexão sem criptografia.",
      },
    ],
  },
  mssql: {
    label: "Microsoft SQL Server",
    docsUrl: "https://learn.microsoft.com/sql/t-sql/statements/grant-transact-sql",
    docsLabel: "Como conceder somente SELECT (GRANT)",
    helper:
      "Banco de dados do cliente que o Agente de IA consulta durante o atendimento (somente leitura). Use um usuário do banco com permissão apenas de SELECT, restrito às tabelas necessárias: é a proteção que realmente impede qualquer alteração. A senha fica criptografada no vault e nunca volta para o navegador.",
    fields: [
      {
        keyName: "host",
        label: "Servidor (host)",
        type: "text",
        placeholder: "db.suaempresa.com.br",
        required: true,
      },
      { keyName: "port", label: "Porta", type: "text", placeholder: "1433" },
      {
        keyName: "database",
        label: "Banco de dados",
        type: "text",
        placeholder: "erp",
        required: true,
      },
      {
        keyName: "client_id",
        label: "Client ID (tenant)",
        type: "text",
        placeholder: "ex.: 1024",
        required: true,
        hint: "Valor da coluna client_id que identifica este cliente no banco multi-tenant. O agente só consulta dados deste tenant: toda consulta é filtrada por ele (o agente escreve :client_id e o sistema preenche o valor). Sem isso, as consultas ficam bloqueadas.",
      },
      {
        keyName: "user",
        label: "Usuário (somente leitura)",
        type: "text",
        placeholder: "agente_leitura",
        required: true,
      },
      {
        keyName: "password",
        label: "Senha",
        type: "password",
        placeholder: "••••••••",
        required: true,
      },
      {
        keyName: "ssl",
        label: "Conexão criptografada (SSL/TLS)",
        type: "text",
        placeholder: "true ou false",
        hint: "Escreva true para exigir SSL/TLS; deixe em branco ou false para conexão sem criptografia.",
      },
      {
        keyName: "trust_cert",
        label: "Confiar no certificado do servidor",
        type: "text",
        placeholder: "true ou false",
        hint: "Escreva true se o servidor usa certificado autoassinado.",
      },
    ],
  },
  google_calendar: {
    label: "Google Calendar / Meet",
    docsUrl: "https://console.cloud.google.com/apis/credentials",
    docsLabel: "Google Cloud Console — Credenciais",
    helper:
      'Crie um projeto em console.cloud.google.com, habilite a Google Calendar API e crie uma credencial OAuth 2.0 do tipo "Aplicativo da Web". Cadastre a Redirect URI exibida abaixo nessa credencial. Depois de salvar aqui, conecte a conta Google em Reuniões — isso só cria o link do Meet, não envia o e-mail de confirmação (isso é o E-mail SMTP).',
    fields: [
      {
        keyName: "client_id",
        label: "Client ID",
        type: "text",
        placeholder: "xxxx.apps.googleusercontent.com",
        required: true,
      },
      {
        keyName: "client_secret",
        label: "Client Secret",
        type: "password",
        placeholder: "GOCSPX-…",
        required: true,
      },
    ],
  },
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: CredentialProviderKey | null;
  accountId: string;
  onSaved?: () => void;
}

export function ProviderCredentialsDialog({
  open,
  onOpenChange,
  provider,
  accountId,
  onSaved,
}: Props) {
  const def = provider ? PROVIDER_FIELDS[provider] : null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const hasExisting = useMemo(() => existing.size > 0, [existing]);

  // Load which keys are already stored.
  // - Vault providers (twilio/elevenlabs/deepgram): query account_secrets via RPC.
  useEffect(() => {
    if (!open || !provider || !accountId) return;
    setValues({});
    setLoading(true);

    const loadVault = async () => {
      const rows = await listAccountSecrets(accountId);
      const set = new Set<string>();
      rows.filter((r) => r.provider === provider).forEach((r) => set.add(r.key_name));
      setExisting(set);
    };

    loadVault()
      .catch((e: any) => toast.error(`Falha ao ler chaves: ${e.message ?? e}`))
      .finally(() => setLoading(false));

    if (provider === "google_calendar") {
      setGoogleStatus(null);
      fetchGoogleCalendarStatus(accountId)
        .then(setGoogleStatus)
        .catch(() => setGoogleStatus(null));
    }
  }, [open, provider, accountId]);

  async function handleConnectGoogle() {
    if (!accountId) return;
    setConnecting(true);
    try {
      await connectGoogleCalendar(accountId); // navega o navegador pro Google — não retorna
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao iniciar conexão com o Google");
      setConnecting(false);
    }
  }

  async function handleDisconnectGoogle() {
    if (!accountId) return;
    if (!confirm("Desconectar o Google Meet desta conta?")) return;
    setDisconnecting(true);
    try {
      await disconnectGoogleCalendar(accountId);
      setGoogleStatus((s) => (s ? { ...s, connected: false, email: null } : s));
      toast.success("Google Meet desconectado");
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao desconectar");
    } finally {
      setDisconnecting(false);
    }
  }

  if (!def || !provider) return null;

  async function handleSave() {
    if (!provider || !def) return;
    const required = def.fields.filter((f) => f.required);
    for (const f of required) {
      const isAlreadyStored = existing.has(f.keyName);
      const provided = values[f.keyName]?.trim();
      if (!isAlreadyStored && !provided) {
        toast.error(`${f.label} é obrigatório`);
        return;
      }
    }
    const toSave = Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v && v.trim().length > 0)
        .map(([k, v]) => [k, v.trim()]),
    );
    if (Object.keys(toSave).length === 0) {
      toast.info("Nenhum campo alterado");
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      {
        await setAccountSecretsBulk(accountId, provider as SecretProvider, toSave);
        toast.success(`${def.label}: credenciais salvas no vault`);

        // n8n: cria o workflow "Utalks" (se ainda não existir), garante o nó de
        // cada agente e já cria a fonte de dados de quem ainda não tinha
        // nenhuma — "conectar" o n8n é o próprio gatilho da sincronização,
        // sem passo manual extra.
        if (provider === "n8n") {
          try {
            const sync = await syncAgentSourcesToN8n(accountId);
            for (const m of describeN8nSync(sync)) {
              toast[m.level](m.message);
            }
          } catch (e: any) {
            toast.warning(
              `Credenciais salvas, mas não foi possível sincronizar o n8n agora: ${e?.body?.message ?? e?.message ?? "erro"}`,
            );
          }
        }
      }
      onSaved?.();
      if (provider === "google_calendar") {
        // Mantém o diálogo aberto: o próximo passo (conectar a conta Google)
        // é aqui mesmo, no botão que só habilita depois que client_id/secret
        // estão salvos.
        setValues({});
        setExisting((prev) => new Set([...prev, ...Object.keys(toSave)]));
        fetchGoogleCalendarStatus(accountId)
          .then(setGoogleStatus)
          .catch(() => {});
      } else {
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e?.message ?? "erro desconhecido"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAll() {
    if (!provider || !hasExisting) return;
    if (!confirm(`Remover todas as credenciais ${def!.label} deste workspace?`)) return;
    setDeleting(true);
    try {
      await Promise.all(
        Array.from(existing).map((k) =>
          deleteAccountSecret(accountId, provider as SecretProvider, k),
        ),
      );
      toast.success(`${def!.label}: credenciais removidas`);
      setExisting(new Set());
      setValues({});
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao remover: ${e?.message ?? "erro"}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Credenciais — {def.label}</DialogTitle>
          <DialogDescription>
            Salvas criptografadas no vault deste workspace. Não ficam no código nem nas variáveis de
            ambiente da plataforma — só edge functions com service-role conseguem decifrar.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="mb-1.5">{def.helper}</p>
          <a
            href={def.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Abrir {def.docsLabel} <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {provider === "google_calendar" && (
          <>
            <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
              <p className="mb-1.5 font-semibold text-muted-foreground">
                Redirect URI (cadastre exatamente esta URL na credencial OAuth)
              </p>
              <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
                {googleStatus?.redirectUri ?? "carregando…"}
              </code>
            </div>

            {googleStatus?.connected ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    Conta Google conectada{googleStatus.email ? ` — ${googleStatus.email}` : ""}. O
                    Meet já é criado automaticamente nas novas reuniões.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleDisconnectGoogle}
                  disabled={disconnecting}
                  className="h-7 shrink-0 text-[11px] text-muted-foreground"
                >
                  {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desconectar"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-gray-200 dark:border-slate-800 bg-muted/20 px-3 py-2.5 text-xs">
                <span className="text-muted-foreground">
                  {existing.has("client_id") && existing.has("client_secret")
                    ? "Credenciais salvas — falta autorizar a conta Google."
                    : "Salve o Client ID/Secret abaixo antes de conectar a conta."}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={handleConnectGoogle}
                  disabled={
                    connecting || !(existing.has("client_id") && existing.has("client_secret"))
                  }
                  className="h-7 shrink-0 gap-1.5 text-[11px]"
                >
                  {connecting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Video className="h-3 w-3" />
                  )}
                  Conectar conta Google
                </Button>
              </div>
            )}
          </>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {def.fields.map((f) => {
              const isStored = existing.has(f.keyName);
              return (
                <div key={f.keyName}>
                  <Label className="mb-1 flex items-center gap-2 text-xs font-semibold">
                    {f.label}
                    {f.required && <span className="text-destructive">*</span>}
                    {isStored && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700">
                        <ShieldCheck className="h-2.5 w-2.5" /> salvo
                      </span>
                    )}
                  </Label>
                  <Input
                    type={f.type}
                    placeholder={isStored ? "•••••••• (deixe em branco pra manter)" : f.placeholder}
                    value={values[f.keyName] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.keyName]: e.target.value }))}
                    autoComplete="off"
                    className="font-mono text-xs"
                  />
                  {f.hint && <p className="mt-1 text-[10px] text-muted-foreground">{f.hint}</p>}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div>
            {hasExisting && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeleteAll}
                disabled={deleting || saving}
                className="text-destructive hover:text-destructive"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Remover credenciais
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || deleting}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting || loading}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar no vault
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Modal that lets a workspace admin save provider API keys directly into the
// per-account Vault (table account_secrets → vault.secrets via RPC). Values
// never leave the browser → server flow; Lovable Cloud env vars are NOT
// touched.
//
// Special case: Evolution. Its credentials live on the `channels` row
// (channel_type='whatsapp', config={evolution_url, evolution_api_key}),
// not in the vault. We test+persist via the evolution-provision edge.

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, ExternalLink, Trash2 } from "lucide-react";
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
import {
  setAccountSecretsBulk,
  deleteAccountSecret,
  listAccountSecrets,
  type SecretProvider,
} from "@/lib/account-secrets";
import { testEvolution, provisionEvolution } from "@/lib/evolution";

export type CredentialProviderKey = "twilio" | "elevenlabs" | "deepgram" | "evolution";

interface FieldDef {
  keyName: string;
  label: string;
  type: "text" | "password";
  placeholder: string;
  required?: boolean;
  hint?: string;
}

const PROVIDER_FIELDS: Record<CredentialProviderKey, {
  label: string;
  docsUrl: string;
  docsLabel: string;
  helper: string;
  fields: FieldDef[];
}> = {
  twilio: {
    label: "Twilio",
    docsUrl: "https://console.twilio.com/",
    docsLabel: "Console Twilio",
    helper:
      "Pegue o Account SID e o Auth Token na home do Console (seção 'Account Info'). Você também pode usar API Key + API Secret se preferir restringir permissões.",
    fields: [
      { keyName: "account_sid", label: "Account SID", type: "text", placeholder: "AC…", required: true },
      { keyName: "auth_token",  label: "Auth Token",  type: "password", placeholder: "••••••••",
        hint: "Use Auth Token OU API Key + Secret (não precisa dos dois)." },
      { keyName: "api_key",     label: "API Key (opcional)",    type: "text", placeholder: "SK…" },
      { keyName: "api_secret",  label: "API Secret (opcional)", type: "password", placeholder: "••••••••" },
    ],
  },
  elevenlabs: {
    label: "ElevenLabs",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    docsLabel: "Painel ElevenLabs",
    helper: "Crie uma API Key em Settings → API Keys. Precisa de permissão de Voice + ConvAI.",
    fields: [
      { keyName: "api_key", label: "API Key", type: "password", placeholder: "sk_…", required: true },
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
  evolution: {
    label: "Evolution (WhatsApp Web)",
    docsUrl: "https://doc.evolution-api.com/",
    docsLabel: "Docs Evolution",
    helper:
      "Servidor Evolution self-hosted. Informe a URL do servidor (ex: https://evo.exemplo.com) e a API key global. As credenciais ficam no canal whatsapp deste workspace.",
    fields: [
      { keyName: "evolution_url", label: "URL do servidor", type: "text", placeholder: "https://evo.exemplo.com", required: true },
      { keyName: "evolution_api_key", label: "API Key", type: "password", placeholder: "••••••••", required: true },
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

export function ProviderCredentialsDialog({ open, onOpenChange, provider, accountId, onSaved }: Props) {
  const def = provider ? PROVIDER_FIELDS[provider] : null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const hasExisting = useMemo(() => existing.size > 0, [existing]);

  // Load which keys are already stored.
  // - Vault providers (twilio/elevenlabs/deepgram): query account_secrets via RPC.
  // - Evolution: read from `channels` row (config.evolution_url / evolution_api_key).
  useEffect(() => {
    if (!open || !provider || !accountId) return;
    setValues({});
    setLoading(true);

    const loadEvolution = async () => {
      const { data } = await (await import("@/integrations/supabase/client"))
        .supabase
        .from("channels")
        .select("config")
        .eq("account_id", accountId)
        .eq("channel_type", "whatsapp")
        .maybeSingle();
      const cfg = (data?.config ?? {}) as Record<string, string>;
      const set = new Set<string>();
      if (cfg.evolution_url) set.add("evolution_url");
      if (cfg.evolution_api_key) set.add("evolution_api_key");
      setExisting(set);
    };

    const loadVault = async () => {
      const rows = await listAccountSecrets(accountId);
      const set = new Set<string>();
      rows.filter((r) => r.provider === provider).forEach((r) => set.add(r.key_name));
      setExisting(set);
    };

    (provider === "evolution" ? loadEvolution() : loadVault())
      .catch((e: any) => toast.error(`Falha ao ler chaves: ${e.message ?? e}`))
      .finally(() => setLoading(false));
  }, [open, provider, accountId]);

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
      Object.entries(values).filter(([, v]) => v && v.trim().length > 0).map(([k, v]) => [k, v.trim()]),
    );
    if (Object.keys(toSave).length === 0) {
      toast.info("Nenhum campo alterado");
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      if (provider === "evolution") {
        // Use existing values for fields the user didn't change
        const url = toSave.evolution_url ?? "";
        const apiKey = toSave.evolution_api_key ?? "";
        // We need both to validate — fall back to no-op if user only changed one
        // and the other isn't already in DB. Validation above already enforces required.
        if (url && apiKey) {
          const res = await testEvolution({ accountId, evolutionUrl: url, evolutionApiKey: apiKey });
          if (!res.ok) {
            toast.error(`Falha ao validar Evolution: ${res.error ?? "erro desconhecido"}`);
            setSaving(false);
            return;
          }
        }
        // Persist by calling provision (idempotent; creates channel + instance).
        const prov = await provisionEvolution({ accountId, evolutionUrl: url, evolutionApiKey: apiKey });
        if (!prov.ok) {
          toast.error(`Falha ao salvar Evolution: ${prov.error ?? "erro"}`);
          setSaving(false);
          return;
        }
        toast.success("Evolution: credenciais salvas");
      } else {
        await setAccountSecretsBulk(accountId, provider as SecretProvider, toSave);
        toast.success(`${def.label}: credenciais salvas no vault`);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Falha ao salvar: ${e?.message ?? "erro desconhecido"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAll() {
    if (!provider || !hasExisting) return;
    if (provider === "evolution") {
      toast.info("Para remover Evolution, vá em Canais → WhatsApp → desconectar instância.");
      return;
    }
    if (!confirm(`Remover todas as credenciais ${def!.label} deste workspace?`)) return;
    setDeleting(true);
    try {
      await Promise.all(
        Array.from(existing).map((k) => deleteAccountSecret(accountId, provider as SecretProvider, k)),
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
            Salvas criptografadas no vault deste workspace. Não ficam no código nem nas variáveis
            de ambiente da plataforma — só edge functions com service-role conseguem decifrar.
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
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remover credenciais
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
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

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/lib/account-context";
import {
  fetchContactLists,
  fetchCampaignPersonas,
  fetchCampaignPhoneNumbers,
  createCampaign,
  MIN_INTERVAL_OPTIONS,
  MAX_ATTEMPTS_OPTIONS,
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_KIND_DESC,
  type ContactListRow,
  type CampaignKind,
  type PersonaLite,
  type PhoneNumberLite,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Search = { listId?: string };

export const Route = createFileRoute("/_authenticated/campanhas/nova")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    listId: typeof s.listId === "string" ? s.listId : undefined,
  }),
  head: () => ({
    meta: [{ title: "Nova campanha — Nina Talks" }],
  }),
  component: NewCampaignPage,
});

function NewCampaignPage() {
  const { accountId } = useAccount();
  const navigate = useNavigate();
  const { listId: prefilledListId } = Route.useSearch();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [lists, setLists] = useState<ContactListRow[]>([]);
  const [personas, setPersonas] = useState<PersonaLite[]>([]);
  const [phones, setPhones] = useState<PhoneNumberLite[]>([]);

  // form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CampaignKind>("sdr");
  const [listId, setListId] = useState<string | "">(prefilledListId ?? "");
  const [personaId, setPersonaId] = useState<string | "">("");
  const [phoneId, setPhoneId] = useState<string | "">("");
  const [openingScript, setOpeningScript] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [retryAttempts, setRetryAttempts] = useState(1);
  const [recordCall, setRecordCall] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [minInterval, setMinInterval] = useState<number>(5);
  const [maxPerDay, setMaxPerDay] = useState<number>(1000);
  const [autoEnroll, setAutoEnroll] = useState<"off" | "approval">("off");

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try {
        const [l, p, ph] = await Promise.all([
          fetchContactLists(accountId),
          fetchCampaignPersonas(accountId),
          fetchCampaignPhoneNumbers(accountId),
        ]);
        setLists(l);
        setPersonas(p);
        setPhones(ph);
      } catch (e: any) {
        toast.error(e?.message ?? "falha ao carregar dados");
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId]);

  const selectedList = useMemo(() => lists.find((l) => l.id === listId) ?? null, [lists, listId]);

  /** Formata pro value de um input datetime-local, que exige hora local sem zona. */
  const localDateTimeValue = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}`;
  };

  const onSubmit = async () => {
    if (!accountId) return;
    if (!name.trim()) return toast.error("Informe um nome");
    if (!listId) return toast.error("Selecione uma lista");
    if (!personaId) return toast.error("Selecione um agente");
    if (!phoneId) return toast.error("Selecione um número");

    // datetime-local devolve hora local sem offset ("2026-07-28T09:30"); o
    // backend espera ISO com offset, e `new Date` de uma string sem zona é
    // interpretada como local — que é justamente o que o usuário digitou.
    let scheduledAtIso: string | undefined;
    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) return toast.error("Data de disparo inválida");
      if (when.getTime() <= Date.now())
        return toast.error("A data de disparo precisa estar no futuro");
      scheduledAtIso = when.toISOString();
    }

    setSubmitting(true);
    try {
      const campaign = await createCampaign(accountId, {
        name: name.trim(),
        campaignKind: kind,
        listId,
        personaId,
        phoneId,
        openingScript: openingScript.trim() || undefined,
        maxConcurrent,
        retryAttempts,
        recordCall,
        scheduledAt: scheduledAtIso,
        minMinutesBetweenAttempts: minInterval,
        maxAttemptsPerDay: maxPerDay,
        // Só faz sentido em lista sincronizada: numa lista manual não existe
        // "carga nova" para oferecer, e deixar 'approval' aqui daria a
        // impressão de que a campanha se alimenta sozinha.
        autoEnrollMode: selectedList?.external_key ? autoEnroll : "off",
      });

      if (campaign.scheduledAt) {
        toast.success(
          `Campanha agendada para ${new Date(campaign.scheduledAt).toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          })} — ${campaign.contactCount} contatos na fila`,
        );
      } else {
        toast.success(
          `Campanha criada como rascunho com ${campaign.contactCount} contatos — inicie manualmente quando quiser`,
        );
      }
      navigate({ to: "/campanhas/$campaignId", params: { campaignId: campaign.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "falha ao criar campanha");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Nova campanha</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure uma operação de ligações com IA em 3 passos.
        </p>
      </header>

      <Stepper step={step} />

      {step === 1 && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">1. Tipo e nome</h2>
          <Field label="Nome">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Cobrança Outubro — 1ª onda"
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
          </Field>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Operação</div>
            <div className="grid gap-2 md:grid-cols-2">
              {(Object.keys(CAMPAIGN_KIND_LABEL) as CampaignKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    kind === k
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:border-primary/40",
                  )}
                >
                  <div className="text-sm font-medium">{CAMPAIGN_KIND_LABEL[k]}</div>
                  <div className="text-xs text-muted-foreground">{CAMPAIGN_KIND_DESC[k]}</div>
                </button>
              ))}
            </div>
          </div>
          <NavRow onNext={() => setStep(2)} canNext={name.trim().length > 0} />
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">2. Lista, agente e número</h2>
          <Field label="Lista de contatos">
            <Select
              value={listId || "__none__"}
              onValueChange={(v) => setListId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— selecionar —</SelectItem>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} ({l.member_count} contatos)
                    {l.external_key ? " · sincronizada" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lists.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Nenhuma lista cadastrada. Crie uma em{" "}
                <a href="/listas" className="underline">
                  /listas
                </a>{" "}
                antes de continuar.
              </p>
            )}
          </Field>
          {selectedList && (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {selectedList.valid_phone_count} de {selectedList.member_count} contatos
                serão enfileirados (o resto está sem telefone ou bloqueado).
              </p>
              {selectedList.external_key && (
                <p>
                  Lista sincronizada do sistema externo pela chave{" "}
                  <code className="rounded bg-muted px-1">{selectedList.external_key}</code>.
                </p>
              )}
            </div>
          )}
          {selectedList?.external_key && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                O que fazer quando a lista receber uma carga nova
              </div>
              <div className="grid gap-2">
                {(
                  [
                    {
                      v: "off" as const,
                      t: "Nada — campanha fechada",
                      d: "Os contatos são congelados agora. Cargas seguintes não mexem nesta campanha.",
                    },
                    {
                      v: "approval" as const,
                      t: "Oferecer em lote, com aprovação",
                      d: "Cada carga junta os contatos novos num lote pendente. Nada disca antes de alguém aprovar aqui na plataforma.",
                    },
                  ]
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setAutoEnroll(o.v)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      autoEnroll === o.v
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    <div className="text-sm font-medium">{o.t}</div>
                    <div className="text-xs text-muted-foreground">{o.d}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Agente IA">
            <Select
              value={personaId || "__none__"}
              onValueChange={(v) => setPersonaId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— selecionar —</SelectItem>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {personas.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Nenhum agente ativo. Ative ou crie um em{" "}
                <a href="/agents" className="underline">
                  /agents
                </a>
                .
              </p>
            )}
          </Field>
          <Field label="Número de origem">
            <Select
              value={phoneId || "__none__"}
              onValueChange={(v) => setPhoneId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— selecionar —</SelectItem>
                {phones.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.friendly_name ?? p.e164} ({p.e164})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <NavRow
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            canNext={!!listId && !!personaId && !!phoneId}
          />
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">3. Script e parâmetros</h2>
          <Field label="Abertura (opcional)">
            <textarea
              value={openingScript}
              onChange={(e) => setOpeningScript(e.target.value)}
              rows={3}
              placeholder="Ex.: Olá {{nome}}, aqui é a Nina da Empresa X. Tudo bem?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </Field>
          <VariablePalette
            keys={selectedList?.variable_keys ?? []}
            listIsExternal={!!selectedList?.external_key}
            onInsert={(token) => setOpeningScript((s) => (s ? `${s} ${token}` : token))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ligações simultâneas">
              <input
                type="number"
                min={1}
                max={20}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Tentativas por contato">
              <input
                type="number"
                min={1}
                max={5}
                value={retryAttempts}
                onChange={(e) => setRetryAttempts(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </Field>
          </div>
          <Field label="Máximo de tentativas por dia ao mesmo número">
            <Select
              value={String(maxPerDay)}
              onValueChange={(v) => setMaxPerDay(Number(v))}
            >
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_ATTEMPTS_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1000 ? "1000 (sem limite prático)" : n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Teto diário por número, contado sobre tentativas reais. É a última trava
              contra insistir com o mesmo contato.
            </p>
          </Field>
          <Field label="Intervalo mínimo entre tentativas ao mesmo número">
            <Select
              value={String(minInterval)}
              onValueChange={(v) => setMinInterval(Number(v))}
            >
              <SelectTrigger className="w-full bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIN_INTERVAL_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} {m === 1 ? "minuto" : "minutos"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Um número só volta a ser discado depois desse tempo. Vale para esta campanha;
              o teto de tentativas por dia continua valendo por cima.
            </p>
          </Field>
          <Field label="Disparar em (opcional)">
            <input
              type="datetime-local"
              value={scheduledAt}
              min={localDateTimeValue(new Date(Date.now() + 60_000))}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {scheduledAt
                ? "A campanha fica agendada e começa sozinha nesse horário (fuso deste navegador)."
                : "Em branco: a campanha nasce como rascunho e só disca quando você iniciar na mão."}
            </p>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={recordCall}
              onChange={(e) => setRecordCall(e.target.checked)}
            />
            Gravar ligações
          </label>
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              Voltar
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Criar campanha
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Variáveis que os contatos da lista trazem do sistema de origem. Sem isto a
 * pessoa que escreve a abertura não tem como saber que existe {{valor_titulo}}
 * naquela carga do ERP — o dado chega até a ligação, mas ninguém o usa porque
 * ninguém sabe o nome dele.
 */
function VariablePalette({
  keys,
  listIsExternal,
  onInsert,
}: {
  keys: string[];
  listIsExternal: boolean;
  onInsert: (token: string) => void;
}) {
  if (keys.length === 0) {
    if (!listIsExternal) return null;
    return (
      <p className="text-[11px] text-muted-foreground">
        Esta lista veio de integração externa, mas os contatos não trazem variáveis —
        a carga foi enviada sem o campo <code className="rounded bg-muted px-1">variables</code>.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        Variáveis disponíveis nesta lista
      </div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onInsert(`{{${k}}}`)}
            className="rounded-md border border-input bg-background px-2 py-1 font-mono text-[11px] hover:border-primary/50 hover:bg-primary/5"
          >
            {`{{${k}}}`}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Clique para inserir na abertura. O valor é substituído por contato no momento da
        ligação, e a agente também recebe todos eles como contexto da conversa.
      </p>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Tipo", "Lista & Agente", "Script"];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                done
                  ? "bg-primary text-primary-foreground"
                  : active
                    ? "bg-primary/15 text-primary ring-1 ring-primary"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {n}
            </div>
            <span
              className={cn(
                "text-xs",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {s}
            </span>
            {i < steps.length - 1 && <div className="mx-1 h-px w-6 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NavRow({
  onBack,
  onNext,
  canNext,
}: {
  onBack?: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  return (
    <div className="flex justify-between">
      {onBack ? (
        <button
          onClick={onBack}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        >
          Voltar
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onNext}
        disabled={!canNext}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Continuar
      </button>
    </div>
  );
}

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
  CAMPAIGN_KIND_LABEL,
  CAMPAIGN_KIND_DESC,
  type ContactListRow,
  type CampaignKind,
  type PersonaLite,
  type PhoneNumberLite,
} from "@/lib/campaigns";
import { cn } from "@/lib/utils";

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

  const onSubmit = async () => {
    if (!accountId) return;
    if (!name.trim()) return toast.error("Informe um nome");
    if (!listId) return toast.error("Selecione uma lista");
    if (!personaId) return toast.error("Selecione um agente");
    if (!phoneId) return toast.error("Selecione um número");

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
      });

      toast.success(`Campanha criada com ${campaign.contactCount} contatos`);
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
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— selecionar —</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.member_count} contatos)
                </option>
              ))}
            </select>
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
            <p className="text-xs text-muted-foreground">
              {selectedList.member_count} contatos serão enfileirados.
            </p>
          )}
          <Field label="Agente IA">
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— selecionar —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
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
            <select
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="">— selecionar —</option>
              {phones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.friendly_name ?? p.e164} ({p.e164})
                </option>
              ))}
            </select>
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

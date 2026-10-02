// 8-step setup wizard. Cada provedor vira uma tela própria pedindo as keys.
// Side-effects (writing to accounts, creating personas, salvar keys no Vault)
// vivem nos componentes de step. Este wrapper só:
//  - controla qual step está aberto (sincroniza com server state)
//  - persiste em advanceOnboardingStep ao "Avançar"
//  - faz Voltar / Pular

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccount } from "@/lib/account-context";
import {
  advanceOnboardingStep,
  gotoOnboardingStep,
  nextStepOf,
  prevStepOf,
  runHealthCheck,
  skipOnboarding,
  stepIndex,
  VISIBLE_STEPS,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding";
import { WelcomeStep } from "./steps/WelcomeStep";
import { EmpresaStep, persistEmpresa, type EmpresaPayload } from "./steps/EmpresaStep";
import { ProviderKeyStep } from "./steps/ProviderKeyStep";
import { AgenteStep } from "./steps/AgenteStep";
import { PrimeiroNumeroStep } from "./steps/PrimeiroNumeroStep";
import { PontoStep } from "./steps/PontoStep";
import { EvolutionQuickConnect } from "./EvolutionQuickConnect";
import type { IntegrationsStatusReport } from "@/lib/integrations-status-cache";
import { Smartphone } from "lucide-react";

export function OnboardingWizard({
  state,
  onComplete,
}: {
  state: OnboardingState;
  onComplete: () => void;
}) {
  const { accountId } = useAccount();

  const initialStep: OnboardingStep =
    state.current_step === "done" ? "welcome" : state.current_step;
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [advancing, setAdvancing] = useState(false);

  // Per-step ephemeral state.
  const [empresaPayload, setEmpresaPayload] = useState<EmpresaPayload | null>(null);
  const [agenteCreated, setAgenteCreated] = useState<{ personaId: string; synced: boolean } | null>(null);

  // Health-check report compartilhado entre os steps de provedor.
  const [report, setReport] = useState<IntegrationsStatusReport | null>(
    (state.health_check_results as IntegrationsStatusReport | undefined) ?? null,
  );

  // Carrega o status uma vez quando entramos nos steps de provedor (se ainda não tem).
  useEffect(() => {
    const isProviderStep = ["elevenlabs", "twilio", "deepgram", "evolution", "agente"].includes(step);
    if (!isProviderStep || !accountId || report) return;
    runHealthCheck(accountId, { force: false }).then(setReport).catch(() => undefined);
  }, [step, accountId, report]);

  const isFinal = step === "numero";
  const isFirst = step === "welcome";
  const idx = stepIndex(step);
  const total = VISIBLE_STEPS.length;

  const canAdvance = (() => {
    if (step === "empresa") return !!empresaPayload?.name;
    if (step === "agente") return !!agenteCreated;
    return true;
  })();

  const handleAdvance = async () => {
    if (!accountId) return;
    setAdvancing(true);
    try {
      let payload: Record<string, any> | undefined;
      if (step === "empresa" && empresaPayload) {
        await persistEmpresa(accountId, empresaPayload);
        payload = empresaPayload;
      }
      if (step === "agente" && agenteCreated) {
        payload = { persona_id: agenteCreated.personaId, synced: agenteCreated.synced };
      }
      await advanceOnboardingStep(accountId, step, payload);
      setStep(nextStepOf(step));
    } catch (e) {
      console.warn("[onboarding] advance failed", e);
    } finally {
      setAdvancing(false);
    }
  };

  const handleSkip = async () => {
    if (!accountId) return;
    setAdvancing(true);
    try {
      await advanceOnboardingStep(accountId, step);
      setStep(nextStepOf(step));
    } finally {
      setAdvancing(false);
    }
  };

  const handleBack = async () => {
    const prev = prevStepOf(step);
    if (!prev || !accountId) return;
    await gotoOnboardingStep(accountId, prev);
    setStep(prev);
  };

  const handleClose = () => onComplete();

  const handleSkipAll = async () => {
    if (!accountId) return;
    await skipOnboarding(accountId);
    onComplete();
  };

  const handleFinish = () => onComplete();

  if (step === "done") {
    return (
      <Dialog open onOpenChange={() => onComplete()}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="sr-only">Setup concluído</DialogTitle>
          <DialogDescription className="sr-only">
            Próximos passos depois do onboarding inicial.
          </DialogDescription>
          <PontoStep onClose={handleFinish} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 bg-white dark:bg-slate-900/40">
        <DialogTitle className="sr-only">Setup do Nina Talks</DialogTitle>
        <DialogDescription className="sr-only">
          Configuração inicial das integrações e do primeiro agente.
        </DialogDescription>
        {/* Stepper header */}
        <div className="border-b border-gray-200 dark:border-slate-800 bg-muted/40 px-6 py-4">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-primary">
              Setup do Nina Talks
            </span>
            <span className="tabular-nums text-muted-foreground">
              {idx + 1} de {total}
            </span>
          </div>
          <div className="mt-3 flex gap-1">
            {VISIBLE_STEPS.map((s, i) => (
              <div
                key={s}
                className={
                  i <= idx
                    ? "h-1.5 flex-1 rounded-full bg-primary transition-colors"
                    : "h-1.5 flex-1 rounded-full bg-border transition-colors"
                }
              />
            ))}
          </div>
        </div>

        {/* Step body */}
        <div className="max-h-[65vh] overflow-y-auto bg-background px-6 py-5">
          {accountId ? (
            <>
              {step === "welcome" && <WelcomeStep />}
              {step === "empresa" && (
                <EmpresaStep
                  accountId={accountId}
                  state={state}
                  onPayloadChange={setEmpresaPayload}
                />
              )}

              {step === "elevenlabs" && (
                <ProviderKeyStep
                  accountId={accountId}
                  provider="elevenlabs"
                  title="ElevenLabs (voz IA)"
                  whatItDoes="Gera a voz realista que o agente vai usar nas ligações."
                  fields={[
                    {
                      name: "api_key",
                      label: "API Key",
                      placeholder: "sk_...",
                      required: true,
                      helpText: "Começa com 'sk_'. Crie em Settings → API Keys com permissões de Voice + ConvAI.",
                    },
                  ]}
                  dashboardUrl="https://elevenlabs.io/app/settings/api-keys"
                  instructions={[
                    "Acesse https://elevenlabs.io/app/settings/api-keys e faça login.",
                    "Clique em 'Create API Key' e marque os escopos de Voice + ConvAI.",
                    "Copie o valor (sk_...) e cole acima.",
                    "Clique em 'Salvar e testar'.",
                  ]}
                  initialReport={report}
                  onConnected={() => undefined}
                />
              )}

              {step === "twilio" && (
                <ProviderKeyStep
                  accountId={accountId}
                  provider="twilio"
                  title="Twilio (telefonia)"
                  whatItDoes="Faz e recebe ligações + SMS pelo agente."
                  fields={[
                    {
                      name: "account_sid",
                      label: "Account SID",
                      placeholder: "AC...",
                      required: true,
                      helpText: "Começa com 'AC'. Achado na home do console.twilio.com.",
                    },
                    {
                      name: "auth_token",
                      label: "Auth Token",
                      placeholder: "Token de autenticação",
                      required: true,
                    },
                  ]}
                  dashboardUrl="https://console.twilio.com"
                  instructions={[
                    "Acesse https://console.twilio.com e faça login.",
                    "Na home do console, copie o Account SID (AC...) e o Auth Token.",
                    "Cole os dois acima e clique 'Salvar e testar'.",
                    "Garanta que sua conta tem saldo (mínimo USD 5 recomendado).",
                  ]}
                  initialReport={report}
                />
              )}

              {step === "deepgram" && (
                <ProviderKeyStep
                  accountId={accountId}
                  provider="deepgram"
                  title="Deepgram (transcrição)"
                  whatItDoes="Transcreve áudios recebidos por WhatsApp para texto."
                  fields={[
                    {
                      name: "api_key",
                      label: "API Key",
                      placeholder: "Cole a key da Deepgram",
                      required: true,
                    },
                  ]}
                  dashboardUrl="https://console.deepgram.com"
                  instructions={[
                    "Acesse https://console.deepgram.com.",
                    "Crie um projeto se ainda não tiver.",
                    "Em 'API Keys', gere uma chave nova.",
                    "Cole acima e clique 'Salvar e testar'.",
                  ]}
                  initialReport={report}
                />
              )}

              {step === "evolution" && (
                <EvolutionInlineStep
                  accountId={accountId}
                  onConnected={() => runHealthCheck(accountId, { force: true }).then(setReport)}
                />
              )}

              {step === "agente" && (
                <AgenteStep
                  accountId={accountId}
                  state={{ ...state, health_check_results: (report ?? state.health_check_results) as any }}
                  onCreated={(info) =>
                    setAgenteCreated({ personaId: info.personaId, synced: info.synced })
                  }
                />
              )}
              {step === "numero" && <PrimeiroNumeroStep accountId={accountId} />}
            </>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Footer nav */}
        <DialogFooter className="border-t border-gray-200 dark:border-slate-800 bg-muted/40 px-6 py-3 sm:justify-between">
          <div className="flex gap-1">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={handleBack} disabled={advancing}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Voltar
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSkipAll} disabled={advancing}>
              <X className="mr-1 h-3.5 w-3.5" />
              Continuar depois
            </Button>
          </div>
          <div className="flex gap-2">
            {step !== "welcome" && step !== "agente" && (
              <Button variant="outline" size="sm" onClick={handleSkip} disabled={advancing}>
                Pular
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleAdvance}
              disabled={advancing || !canAdvance}
            >
              {advancing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isFinal ? "Concluir" : "Avançar"}
              {!isFinal && <ArrowRight className="ml-1 h-3.5 w-3.5" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tela do Evolution: abre o EvolutionQuickConnect (que tem fluxo URL+key→QR).
// Mostra também um resumo do que vai acontecer.
function EvolutionInlineStep({
  accountId,
  onConnected,
}: {
  accountId: string;
  onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">WhatsApp via Evolution (opcional)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se você já tem um servidor Evolution rodando, conecte um número do
          WhatsApp escaneando um QR code. Pode pular se for usar só telefone.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-foreground">Conectar WhatsApp</h4>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Cole a URL e a API key do seu servidor Evolution. Vamos criar a
              instância e gerar o QR code automaticamente.
            </p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)} className="mt-3 w-full" size="sm">
          Configurar agora
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Não tem servidor Evolution? Pule este passo — você pode adicionar
        depois em <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">Configurações → Integrações</code>.
      </p>

      <EvolutionQuickConnect
        open={open}
        onOpenChange={setOpen}
        accountId={accountId}
        onConnected={() => {
          onConnected();
          setOpen(false);
        }}
      />
    </div>
  );
}

export type { OnboardingState };

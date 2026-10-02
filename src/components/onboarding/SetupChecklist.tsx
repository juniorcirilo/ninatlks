// Persistent setup checklist shown in the bottom-right corner while the
// admin's onboarding is incomplete. Click any item to reopen the wizard at
// that step. Shows progress (3/5) and lets the user dismiss.

import { useEffect, useState } from "react";
import { Check, ChevronRight, Circle, X } from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  dismissChecklist,
  getOnboardingState,
  gotoOnboardingStep,
  VISIBLE_STEPS,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding";
import { OnboardingWizard } from "./OnboardingWizard";

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Boas-vindas",
  empresa: "Empresa",
  elevenlabs: "Voz (ElevenLabs)",
  twilio: "Telefonia (Twilio)",
  deepgram: "Transcrição (Deepgram)",
  evolution: "WhatsApp (Evolution)",
  agente: "Agente IA",
  numero: "Número de telefone",
  done: "Pronto",
};

export function SetupChecklist() {
  const { accountId, role } = useAccount();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = () => {
    if (!accountId) return;
    getOnboardingState(accountId).then(setState);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  if (!accountId || role !== "admin" || !state) return null;
  if (state.completed_at) return null;
  if (state.metadata?.checklist_dismissed) return null;
  if (wizardOpen) {
    return (
      <OnboardingWizard
        state={state}
        onComplete={() => {
          setWizardOpen(false);
          refresh();
        }}
      />
    );
  }

  const completed = new Set(state.completed_steps);
  const completedCount = VISIBLE_STEPS.filter((s) => completed.has(s)).length;
  const total = VISIBLE_STEPS.length;

  const handleOpenStep = async (step: OnboardingStep) => {
    if (!accountId) return;
    await gotoOnboardingStep(accountId, step);
    setWizardOpen(true);
  };

  const handleDismiss = async () => {
    if (!accountId) return;
    await dismissChecklist(accountId);
    refresh();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 overflow-hidden rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 shadow-2xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Setup do Nina Talks
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(completedCount / total) * 100}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {completedCount}/{total}
            </span>
          </div>
        </div>
        <ChevronRight
          className={
            open
              ? "h-4 w-4 shrink-0 rotate-90 text-muted-foreground transition-transform"
              : "h-4 w-4 shrink-0 -rotate-90 text-muted-foreground transition-transform"
          }
        />
      </button>

      {open && (
        <div className="border-t border-gray-200 dark:border-slate-800">
          <ul className="space-y-0.5 px-2 py-2">
            {VISIBLE_STEPS.map((s) => {
              const done = completed.has(s);
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => handleOpenStep(s)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className={done ? "flex-1 text-muted-foreground line-through" : "flex-1 text-foreground"}>
                      {STEP_LABELS[s]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-gray-200 dark:border-slate-800 px-3 py-2">
            <button
              type="button"
              onClick={handleDismiss}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Não mostrar mais
            </button>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Continuar →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

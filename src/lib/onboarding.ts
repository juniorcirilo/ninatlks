// Onboarding state for first-time admin setup. Backed by the NestJS
// OnboardingModule (server/src/modules/onboarding) — 6 steps, health-check
// helper hits /accounts/:id/onboarding/health-check.

import { apiClient } from "@/lib/api-client";
import {
  fetchIntegrationsStatus,
  type IntegrationsStatusReport,
} from "@/lib/integrations-status-cache";

export const ONBOARDING_STEPS = [
  "welcome",
  "empresa",
  "elevenlabs",
  "twilio",
  "deepgram",
  "evolution",
  "agente",
  "numero",
  "done",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingState = {
  account_id: string;
  current_step: OnboardingStep;
  completed_steps: string[];
  completed_at: string | null;
  started_at: string;
  metadata: Record<string, any>;
  health_check_results: Record<string, any>;
  health_check_at: string | null;
  dismissed_at: string | null;
};

interface OnboardingStateApiRow {
  accountId: string;
  currentStep: string;
  completedSteps: string[];
  completedAt: string | null;
  startedAt: string;
  metadata: Record<string, any>;
  healthCheckResults: Record<string, any>;
  healthCheckAt: string | null;
  dismissedAt: string | null;
}

function normalizeStep(step: string): OnboardingStep {
  if ((ONBOARDING_STEPS as readonly string[]).includes(step)) {
    return step as OnboardingStep;
  }
  return "welcome";
}

function mapState(r: OnboardingStateApiRow): OnboardingState {
  return {
    account_id: r.accountId,
    current_step: normalizeStep(r.currentStep),
    completed_steps: r.completedSteps ?? [],
    completed_at: r.completedAt,
    started_at: r.startedAt,
    metadata: r.metadata ?? {},
    health_check_results: r.healthCheckResults ?? {},
    health_check_at: r.healthCheckAt ?? null,
    dismissed_at: r.dismissedAt ?? null,
  };
}

export async function getOnboardingState(accountId: string): Promise<OnboardingState | null> {
  try {
    const row = await apiClient.get<OnboardingStateApiRow | null>(
      `/accounts/${accountId}/onboarding`,
    );
    return row ? mapState(row) : null;
  } catch {
    return null;
  }
}

/**
 * Marca o wizard como dispensado de forma persistente. Não reaparecerá em
 * próximos logins até que `reopenOnboarding` seja chamado.
 */
export async function dismissOnboarding(accountId: string): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/onboarding/dismiss`);
}

/**
 * Limpa o `dismissed_at` para que o wizard reapareça no próximo login (ou
 * agora, se a página recarregar).
 */
export async function reopenOnboarding(accountId: string): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/onboarding/reopen`);
}

const NEXT: Record<OnboardingStep, OnboardingStep> = {
  welcome: "empresa",
  empresa: "elevenlabs",
  elevenlabs: "twilio",
  twilio: "deepgram",
  deepgram: "evolution",
  evolution: "agente",
  agente: "numero",
  numero: "done",
  done: "done",
};

const PREV: Record<OnboardingStep, OnboardingStep | null> = {
  welcome: null,
  empresa: "welcome",
  elevenlabs: "empresa",
  twilio: "elevenlabs",
  deepgram: "twilio",
  evolution: "deepgram",
  agente: "evolution",
  numero: "agente",
  done: "numero",
};

export type VisibleStep = Exclude<OnboardingStep, "done">;
export const VISIBLE_STEPS: VisibleStep[] = [
  "welcome",
  "empresa",
  "elevenlabs",
  "twilio",
  "deepgram",
  "evolution",
  "agente",
  "numero",
];

export function nextStepOf(step: OnboardingStep): OnboardingStep {
  return NEXT[step];
}

export function prevStepOf(step: OnboardingStep): OnboardingStep | null {
  return PREV[step];
}

export function stepIndex(step: OnboardingStep): number {
  // Excludes "done" from the visible 1..5 progression
  const i = (VISIBLE_STEPS as readonly string[]).indexOf(step);
  return i < 0 ? 0 : i;
}

/**
 * Persist the user's progress. If they reached "done", set completed_at.
 * Side effects (writing to accounts, creating personas) live in the step
 * components — this function only mutates the onboarding row.
 */
export async function advanceOnboardingStep(
  accountId: string,
  step: OnboardingStep,
  payload?: Record<string, any>,
): Promise<{ nextStep: OnboardingStep }> {
  const result = await apiClient.post<{ nextStep: OnboardingStep }>(
    `/accounts/${accountId}/onboarding/advance`,
    { step, payload },
  );
  return result;
}

/** Jump directly to any step without marking it complete. */
export async function gotoOnboardingStep(accountId: string, step: OnboardingStep): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/onboarding/goto`, { step });
}

/**
 * "Pular tudo" no wizard. NÃO marca como completed_at — apenas registra que
 * o admin pulou nesta sessão. Assim, ao logar de novo, o modal volta a
 * aparecer (até o admin completar de verdade os 5 steps).
 */
export async function skipOnboarding(accountId: string): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/onboarding/skip`);
}

/**
 * Verdadeiro só se o admin passou de fato pelos 5 steps visíveis.
 * `completed_at` sozinho não basta — sessões antigas podem ter marcado isso
 * via "Pular tudo" sem o admin ter configurado nada.
 */
export function isOnboardingTrulyComplete(state: OnboardingState | null): boolean {
  if (!state) return false;
  if (!state.completed_at) return false;
  const done = new Set(state.completed_steps);
  return VISIBLE_STEPS.every((s) => done.has(s));
}

export async function dismissChecklist(accountId: string): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/onboarding/dismiss-checklist`);
}

/**
 * Run integrations-status and cache the result on the onboarding row so the
 * sidebar checklist can render without re-pinging providers every render.
 */
export async function runHealthCheck(
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<IntegrationsStatusReport> {
  if (opts.force === false) {
    return fetchIntegrationsStatus(accountId, { force: false });
  }
  return apiClient.post<IntegrationsStatusReport>(`/accounts/${accountId}/onboarding/health-check`);
}

// ─── Static option lists used by the wizard ───────────────────────────

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3) — São Paulo" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "America/New_York", label: "Nova York (GMT-5)" },
  { value: "Europe/Lisbon", label: "Lisboa (GMT+0)" },
  { value: "UTC", label: "UTC" },
];

export const INDUSTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "saude", label: "Saúde / Clínicas" },
  { value: "educacao", label: "Educação" },
  { value: "varejo", label: "Varejo / E-commerce" },
  { value: "servicos", label: "Serviços profissionais" },
  { value: "imobiliario", label: "Imobiliário" },
  { value: "financeiro", label: "Financeiro / Cobrança" },
  { value: "automotivo", label: "Automotivo" },
  { value: "alimentacao", label: "Alimentação / Delivery" },
  { value: "tecnologia", label: "Tecnologia" },
  { value: "outro", label: "Outro" },
];

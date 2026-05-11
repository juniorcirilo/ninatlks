// Onboarding state for first-time admin setup. Lives in
// public.org_onboarding_state — one row per account.
//
// We removed the legacy 13-step wizard and the `onboarding_advance` /
// `onboarding_goto` RPCs (they never existed in the schema; the old code
// silently failed). Now: 6 steps, all writes happen client-side via direct
// table updates, and a health-check helper hits the existing
// `integrations-status` edge.

import { supabase } from "@/integrations/supabase/client";
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

// Anything not in the new 6-step list (including the old 13-step enum)
// gets bucketed back to "welcome" so existing accounts see the new flow
// without crashing.
function normalizeStep(step: string): OnboardingStep {
  if ((ONBOARDING_STEPS as readonly string[]).includes(step)) {
    return step as OnboardingStep;
  }
  return "welcome";
}

export async function getOnboardingState(
  accountId: string,
): Promise<OnboardingState | null> {
  const { data, error } = await (supabase as any)
    .from("org_onboarding_state")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    account_id: data.account_id,
    current_step: normalizeStep(data.current_step),
    completed_steps: (data.completed_steps as string[]) ?? [],
    completed_at: data.completed_at,
    started_at: data.started_at,
    metadata: (data.metadata as Record<string, any>) ?? {},
    health_check_results: (data.health_check_results as Record<string, any>) ?? {},
    health_check_at: data.health_check_at ?? null,
    dismissed_at: data.dismissed_at ?? null,
  };
}

/**
 * Marca o wizard como dispensado de forma persistente. Não reaparecerá em
 * próximos logins até que `reopenOnboarding` seja chamado.
 */
export async function dismissOnboarding(accountId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("onboarding_dismiss", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Limpa o `dismissed_at` para que o wizard reapareça no próximo login (ou
 * agora, se a página recarregar).
 */
export async function reopenOnboarding(accountId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("onboarding_reopen", {
    p_account_id: accountId,
  });
  if (error) throw new Error(error.message);
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
  const { data: cur } = await (supabase as any)
    .from("org_onboarding_state")
    .select("completed_steps, metadata")
    .eq("account_id", accountId)
    .maybeSingle();

  const completed = new Set<string>((cur?.completed_steps as string[]) ?? []);
  completed.add(step);
  const metadata = { ...((cur?.metadata as Record<string, any>) ?? {}) };
  if (payload && Object.keys(payload).length) {
    metadata[step] = { ...(metadata[step] ?? {}), ...payload };
  }

  const next = NEXT[step];
  const update: Record<string, any> = {
    current_step: next,
    completed_steps: Array.from(completed),
    metadata,
  };
  if (next === "done") update.completed_at = new Date().toISOString();

  await (supabase as any)
    .from("org_onboarding_state")
    .upsert(
      { account_id: accountId, ...update },
      { onConflict: "account_id" },
    );

  return { nextStep: next };
}

/** Jump directly to any step without marking it complete. */
export async function gotoOnboardingStep(
  accountId: string,
  step: OnboardingStep,
): Promise<void> {
  await (supabase as any)
    .from("org_onboarding_state")
    .upsert(
      { account_id: accountId, current_step: step },
      { onConflict: "account_id" },
    );
}

/**
 * "Pular tudo" no wizard. NÃO marca como completed_at — apenas registra que
 * o admin pulou nesta sessão. Assim, ao logar de novo, o modal volta a
 * aparecer (até o admin completar de verdade os 5 steps).
 */
export async function skipOnboarding(accountId: string): Promise<void> {
  const { data: cur } = await (supabase as any)
    .from("org_onboarding_state")
    .select("metadata")
    .eq("account_id", accountId)
    .maybeSingle();
  const metadata = {
    ...((cur?.metadata as Record<string, any>) ?? {}),
    last_skipped_at: new Date().toISOString(),
  };
  await (supabase as any)
    .from("org_onboarding_state")
    .upsert(
      { account_id: accountId, metadata },
      { onConflict: "account_id" },
    );
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
  const { data: cur } = await (supabase as any)
    .from("org_onboarding_state")
    .select("metadata")
    .eq("account_id", accountId)
    .maybeSingle();
  const metadata = { ...((cur?.metadata as Record<string, any>) ?? {}), checklist_dismissed: true };
  await (supabase as any)
    .from("org_onboarding_state")
    .upsert({ account_id: accountId, metadata }, { onConflict: "account_id" });
}

/**
 * Run integrations-status and cache the result on the onboarding row so the
 * sidebar checklist can render without re-pinging providers every render.
 */
export async function runHealthCheck(
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<IntegrationsStatusReport> {
  const report = await fetchIntegrationsStatus(accountId, { force: opts.force ?? true });
  await (supabase as any)
    .from("org_onboarding_state")
    .upsert(
      {
        account_id: accountId,
        health_check_results: report as any,
        health_check_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
  return report;
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

/**
 * Prompt versioning + template engine
 */
import { supabase } from "@/integrations/supabase/client";

export type PromptStatus = "draft" | "staging" | "prod" | "retired";
export type PromptAuthor = "human" | "auto";

export interface PromptVersion {
  id: number;
  account_id: string;
  slug: string;
  version: number;
  parent_version_id: number | null;
  content: string;
  variables: Record<string, unknown>;
  status: PromptStatus;
  eval_score: number | null;
  change_note: string | null;
  author: PromptAuthor;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABELS: Record<PromptStatus, string> = {
  draft: "Rascunho",
  staging: "Staging",
  prod: "Produção",
  retired: "Aposentado",
};

export const STATUS_COLORS: Record<PromptStatus, string> = {
  draft: "bg-white/[0.06] text-muted-foreground",
  staging: "bg-amber-500/20 text-amber-400",
  prod: "bg-emerald-500/20 text-emerald-400",
  retired: "bg-white/[0.06] text-muted-foreground line-through",
};

// ── Template engine ───────────────────────────────────────────────
export function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".");
    let value: any = vars;
    for (const p of parts) {
      if (value && typeof value === "object" && p in value) value = value[p];
      else return "";
    }
    return value == null ? "" : String(value);
  });
}

// ── Built-in prompts ──────────────────────────────────────────────
export const MEMORY_EXTRACTOR_PROMPT = {
  slug: "memory.extractor.v1",
  content: `You are a memory extraction system reading a customer support conversation.
Extract durable, useful facts about the CONTACT (customer) — not the agent.

Output ONLY a JSON array of memory nodes:
{
  "kind": "fact" | "preference" | "trait" | "event" | "objection" | "win" | "entity",
  "summary": "short embedding-friendly sentence in the contact's primary language",
  "content": "longer detail if useful, else null",
  "confidence": 0.0..1.0,
  "importance": 0.0..1.0,
  "expires_in_days": number or null
}

Rules:
- Return [] if no durable signal
- fact: objectively true (city, job, kid's name, product owned)
- preference: how they like communication (channel, tone, time)
- trait: personality pattern (impatient, analytical)
- event: something that happened (moved, got married, churned)
- objection: reason they pushed back
- win: something that worked (phrase, offer, tactic)
- entity: linked person/company
- NEVER invent facts

Conversation:
{{conversation}}`,
};

export const DOSSIER_BUILDER_PROMPT = {
  slug: "memory.dossier.v1",
  content: `Write a 60-second briefing for a support agent about to talk to a customer.

Customer name: {{contact_name}}
Known facts sorted by importance:
{{facts}}

Recent conversations:
{{recent_conversations}}

Structure (markdown):
1. **Header** — one line: who they are + current temperature
2. **Don't forget** — 2-4 bullet points absolutely must remember
3. **Style** — one line on how to talk to them
4. **Recent thread** — 3-5 line summary
5. **Open hooks** — unresolved items

Write in the contact's primary language.`,
};

export const PERSONA_DISTILLER_PROMPT = {
  slug: "persona.distiller.v1",
  content: `You are reverse-engineering a customer service agent's communication style from samples.
Agent name: {{agent_name}}
Samples between <msg> tags:
{{samples}}

Output ONLY JSON:
{
  "voice": "1-2 sentence description",
  "tone": ["adjectives"],
  "vocabulary": {"signature_phrases": [], "avoid_words": [], "fillers": []},
  "openings": [], "closings": [],
  "punctuation": "description",
  "emoji_style": "none | sparse | frequent | descriptive",
  "empathy_pattern": "how they acknowledge feelings",
  "objection_pattern": "how they handle pushback",
  "rhythm": "short bursts | flowing | mixed",
  "primary_language": "iso code"
}`,
};

export const JUDGE_PROMPT = {
  slug: "evals.judge.v1",
  content: `You are an impartial judge evaluating an AI agent's reply to a customer.

Customer's last message:
{{customer_message}}

Agent's reply:
{{agent_reply}}

Persona style (target):
{{persona_style}}

Score each dimension 0..1 and return ONLY JSON:
{
  "style_match": 0.0..1.0,
  "helpfulness": 0.0..1.0,
  "empathy": 0.0..1.0,
  "factual_safety": 0.0..1.0,
  "tone_appropriate": 0.0..1.0,
  "overall": 0.0..1.0,
  "reasoning": "1-2 sentences"
}`,
};

export const PROMPTS = {
  memoryExtractor: MEMORY_EXTRACTOR_PROMPT,
  dossierBuilder: DOSSIER_BUILDER_PROMPT,
  personaDistiller: PERSONA_DISTILLER_PROMPT,
  judge: JUDGE_PROMPT,
} as const;

// ── CRUD ──────────────────────────────────────────────────────────
export async function fetchPromptVersions(accountId: string, slug?: string) {
  let q = supabase
    .from("prompt_versions" as any)
    .select("*")
    .eq("account_id", accountId)
    .order("slug", { ascending: true })
    .order("version", { ascending: false });
  if (slug) q = q.eq("slug", slug);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as PromptVersion[];
}

export async function createPromptVersion(input: {
  accountId: string;
  slug: string;
  content: string;
  variables?: Record<string, unknown>;
  changeNote?: string;
  parentVersionId?: number;
}) {
  // Compute next version
  const { data: existing, error: e1 } = await supabase
    .from("prompt_versions" as any)
    .select("version")
    .eq("account_id", input.accountId)
    .eq("slug", input.slug)
    .order("version", { ascending: false })
    .limit(1);
  if (e1) throw e1;
  const nextVersion = ((existing?.[0] as any)?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("prompt_versions" as any)
    .insert({
      account_id: input.accountId,
      slug: input.slug,
      version: nextVersion,
      content: input.content,
      variables: input.variables ?? {},
      change_note: input.changeNote ?? null,
      parent_version_id: input.parentVersionId ?? null,
      status: "draft",
      author: "human",
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as PromptVersion;
}

/**
 * Promote a prompt version through the lifecycle.
 * draft → staging | staging → prod (demotes prior prod to retired)
 */
export async function promotePromptVersion(id: number) {
  const { data, error } = await supabase.functions.invoke("prompt-promote", {
    body: { id },
  });
  if (error) throw error;
  return data as { promoted: PromptVersion; demoted: PromptVersion[] };
}

export async function seedBuiltinPrompts(accountId: string) {
  // Insert each built-in prompt as version 1 if no version exists yet
  for (const p of Object.values(PROMPTS)) {
    const { data: existing } = await supabase
      .from("prompt_versions" as any)
      .select("id")
      .eq("account_id", accountId)
      .eq("slug", p.slug)
      .limit(1);
    if (existing && existing.length > 0) continue;
    await supabase.from("prompt_versions" as any).insert({
      account_id: accountId,
      slug: p.slug,
      version: 1,
      content: p.content,
      status: "prod",
      author: "auto",
      change_note: "Built-in seed",
    } as any);
  }
}

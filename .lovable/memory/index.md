# Project Memory

## Core
Dark theme forçado, violet/fuchsia. NUNCA light mode.
PT-BR em toda UI. Tema premium glass/gradient.
Lovable Cloud (Supabase) para auth + DB. Multi-tenant com RLS.
Nexus = plataforma omnichannel de atendimento com IA.

## Memories
- [Design tokens](mem://design/tokens) — HSL colors, gradients violet→fuchsia, glass, typography scale, NexusLogo component
- [Auth flow](mem://features/auth) — Email+senha, magic link, auto-create workspace+profile via trigger
- [Multi-tenancy](mem://features/multi-tenancy) — accounts, account_users, user_roles (admin/agent), RLS via has_role/is_account_member
- [Onboarding](mem://features/onboarding) — 7-step wizard, OnboardingGate for admins, org_onboarding_state table
- [Conversations](mem://features/conversations) — contacts, conversations, messages tables with realtime, 3-column inbox UI, status/priority/labels
- [Eval Lab](mem://features/eval-lab) — Synthetic customers + LLM judge + self-improvement loop que gera variantes de prompt baseadas em outcomes reais
- [Outcomes](mem://features/outcomes) — conversation_outcomes + attributions + csat_surveys, auto-CSAT trigger on resolve, /outcomes KPI page, OutcomePanel inline, public webhook + csat-answer edge functions
- [Memory Graph](mem://features/memory-graph) — pgvector 1536, AI extraction/dossier/recall via edge functions, CustomerBrain component
- [Personas](mem://features/personas) — agent_personas style_profile, persona-distill/suggest edge functions, /agents UI, ChatPanel Sugestão IA button
- [Prompt Versioning](mem://features/prompt-versioning) — prompt_versions+deployments com lifecycle draft→staging→prod, interpolate {{var}}, PROMPTS built-in inline, /prompts UI
- [Signals + Incidents](mem://features/signals) — conversation_signals (regex puro, sem LLM) + incident_clusters (cosine match + LLM naming), SignalsOverlay no chat, /incidents page

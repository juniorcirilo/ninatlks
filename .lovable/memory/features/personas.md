---
name: Agent Personas
description: Style cloning, persona deployment per inbox, AI compose reply, auto-reply pipeline via DB trigger
type: feature
---
Tables: agent_personas (style_profile JSONB, system_prompt compiled, voice fields, status draft|training|active|retired, source_user_id NULLABLE for synthetic personas), agent_persona_samples, agent_persona_deployments (persona+inbox unique, mode always|after_hours|overflow|shadow|cron, autonomy auto|suggest|shadow, confidence_threshold, daily_message_budget)
Edge functions: persona-distill (LLM extracts style from last 200 outgoing msgs), persona-suggest (composeReply with dossier+facts injection, returns reply+confidence), persona-auto-reply (full pipeline: resolve deployment → schedule check → compose → confidence gate → autonomy mode dispatch)
DB trigger: trg_messages_auto_reply on messages AFTER INSERT calls persona-auto-reply via pg_net.http_post for incoming public msgs (message_type=0 AND private=false). Requires app.supabase_url + app.supabase_anon_key GUCs set, otherwise no-op.
Autonomy modes in auto-reply: auto = insert public AgentBot message + bump conversation activity; suggest = insert PRIVATE msg with "🤖 [Sugerido por X]" prefix; shadow = log only.
Skip reasons: no_active_persona, outside_schedule, empty_reply, low_confidence, shadow_mode, compose_failed.
UI: /agents page with PersonaCard expandable PersonaDeploymentsPanel (per-inbox toggle, mode/autonomy selects, confidence slider 0-100%). ChatPanel "Sugestão IA" button calls persona-suggest.
AI: gemini-2.5-flash for distill/suggest/auto-reply, temperature 0.7, max 800 tokens.
Confidence heuristic: 0.5 base + 0.1 if reply≥30, +0.1 if ≥100, +0.15 if briefingUsed, +0.1 if msgs≥4, +0.05 if msgs≥10.

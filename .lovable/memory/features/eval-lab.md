---
name: Eval Lab + Self-Improvement
description: Synthetic customer simulations, LLM judge, verdict (promote/hold/reject) e loop de auto-melhoria que gera variantes de prompt
type: feature
---
Tables: eval_scenarios (customer_profile, goal, hidden_traits, success_criteria, difficulty), eval_runs (status queued|running|finished|failed, win_rate, verdict promote|hold|reject, total_cost_cents), eval_conversations (transcript jsonb, outcome won|lost|partial, judge_notes, decisive_turn_index), persona_improvement_attempts (gate de 24h entre tentativas)
Edge functions: eval-run (loop síncrono: customer LLM gemini-2.5-flash-lite temp 0.9 vs agent gemini-2.5-flash temp 0.7, max 6 turns, judge JSON com score/outcome/notes; verdict ≥0.6=promote, ≥0.4=hold, <0.4=reject), improvement-tick (promotePassingEvals rotaciona prod→retired e bumpa persona.version; proposeImprovements pega losing outcomes 30d, gera new_system_prompt via LLM temp 0.3, cria prompt_version status=staging slug=persona.<id>.system, dispara eval-run em fire-and-forget)
UI: /evals route, dialogs ScenarioDialog (slider difficulty) e RunDialog (multi-select pills de cenários), polling 5s enquanto runs ativos, drill-down com transcripts e turno decisivo destacado em ring-amber
Custo aproximado: $0.075/M in + $0.30/M out (gemini-flash) calculado por conversa

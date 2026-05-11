---
name: Outcomes & Credit Attribution
description: conversation_outcomes + outcome_attributions + csat_surveys, edge functions, /outcomes page, OutcomePanel inline
type: feature
---

# Outcomes + Credit Attribution

## Schema
- **conversation_outcomes**: outcome_type (sale_won|sale_lost|churn_prevented|churned|resolved|escalated|abandoned|appointment_booked|payment_received|refund_issued|nps_promoter|nps_detractor), value (centavos), currency, source (webhook|manual|crm_sync|followup_check|inferred_llm|csat), confidence
- **outcome_attributions**: link outcome → message + persona + prompt_version with weight (0..1)
- **csat_surveys**: rating (1-5), feedback, handler_type (ai|human), handler_id, status (pending|answered|expired), expires_at default +48h

## Trigger
`tg_create_csat_on_resolve` AFTER UPDATE on conversations: when status flips to 1 (resolved) and contact_id present, auto-creates pending CSAT row with handler_type/id detected from last outgoing message.

## Edge Functions
- `outcome-create` (auth): insert outcome + auto-split weight equally across AgentBot messages in conversation
- `outcome-summary` (auth): account-wide summary OR persona-specific (?personaId=) — returns byType, totalCount, totalValue, wins, losses, winRate
- `outcome-webhook` (no auth, verify_jwt=false): public CRM endpoint with optional HMAC via X-Signature header against `accounts.internal_attributes.webhookSecret`
- `csat-answer` (no auth): answer survey + auto-create nps_promoter (4-5) | nps_detractor (1-2) | resolved (3) outcome with attribution to handler

## Frontend
- `/outcomes` page: 4 KPI StatCards (Total, Valor capturado, Win Rate, Perdas) + breakdown table with colored pills per OUTCOME_TONES
- `OutcomePanel` inline in ConversationSidebar: list outcomes + inline form (type select + value input)
- Period selector: 1/7/30/90 days

## Tone mapping
- win (emerald): sale_won, churn_prevented, appointment_booked, payment_received, nps_promoter
- loss (rose): sale_lost, churned, refund_issued, nps_detractor, abandoned
- warn (amber): escalated
- neutral (sky): resolved

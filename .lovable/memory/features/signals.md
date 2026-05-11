---
name: Signals + Incident Clusters
description: Sub-textual signal detection (regex-based, no LLM) + incident clustering with LLM naming, /incidents page, SignalsOverlay in chat
type: feature
---

## Schema
- `conversation_signals`: kind, severity 0..1, payload jsonb, action; índices em (conversation_id, detected_at), (account_id, severity), (account_id, kind)
- `incident_clusters`: title, summary, contact_count, conversation_count, status (detected|acknowledged|resolved|false_positive), severity (low|medium|high), tags jsonb, metadata.seedVector (8 dims)
- `incident_cluster_members`: cluster_id × conversation_id UNIQUE, contact_id, match_score

## Detector (signals-detect edge function)
Pure regex, sem LLM. Detecta nas mensagens do customer (message_type=0):
- pause_long: gap >=10min severity=0.85; >=2min severity=0.6
- sentiment_shift: NEGATIVE_PATTERNS (pt+en) → severity=min(0.95, 0.4+0.2*hits) direction=negative; POSITIVE → 0.3 positive
- hesitation: HESITATION_PATTERNS (uh, hmm, talvez, ...) severity=0.4
- caps_lock_burst: upper/letters > 0.6 && letters>=5 severity=0.7
- emoji_escalation: 😡😠🤬💢👎😤😒 count → severity=min(0.9, 0.5+0.15*n)

Rastreio incremental via lookup do último signal.message_id por conversa.

## Clusterer (incidents-cluster edge function)
- Pull signals severity>=0.5 nos kinds principais nas últimas 2h
- Embed via char-hash 8 dims (sem API)
- Match cosine threshold 0.78 nos seedVector dos clusters ativos (24h)
- Se não match e severity>=0.6: LLM call (gemini-flash-lite) para nomear → JSON {title, summary, tags}
- Promove severity baseado em distinct contact_count: >=3 high, >=2 medium

## UI
- `SignalsOverlay`: float top-right da conversa, poll 8s, collapsible com counts + críticos
- `/incidents`: split Ativos/Reconhecidos, auto-refresh 15s, botão "Varredura agora" dispara signals-detect + incidents-cluster
- Cores severity-tinted: high=rose+pulse, medium=amber, low=sky (lint-warned mas semântico)

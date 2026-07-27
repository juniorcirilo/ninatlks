---
name: Customer Memory Graph
description: pgvector-powered memory extraction from conversations with dossier builder and semantic recall
type: feature
---
Tables: customer_memory_nodes (pgvector 1536), customer_memory_edges, contact_facts (key/value), contact_dossiers (cached briefing TTL 6h), memory_extraction_state (worker cursor)
Edge functions: memory-extract (AI extraction from conversation), memory-rebuild (dossier generation), memory-recall (semantic search fallback to importance)
UI: CustomerBrain component in ConversationSidebar — shows briefing, facts chips, memory nodes with kind badges, recall search, extract/rebuild actions
AI: Uses Lovable AI Gateway (gemini-2.5-flash) for extraction and dossier building
Prompts: MEMORY_EXTRACTOR_PROMPT (extract facts/preferences/traits/events), DOSSIER_BUILDER_PROMPT (60s agent briefing)

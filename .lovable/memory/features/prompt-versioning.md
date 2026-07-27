---
name: Prompt Versioning
description: Schema prompt_versions + prompt_deployments com lifecycle draft→staging→prod, template engine interpolate, prompts built-in inline
type: feature
---
Tables: prompt_versions (slug+version unique per account, status draft|staging|prod|retired, eval_score, change_note, author human|auto, parent_version_id pra fork tree), prompt_deployments (vincula versão a inbox/persona com traffic_share 0..1 pra A/B)
Edge function: prompt-promote (transição draft→staging ou staging→prod, demove prior prod do mesmo slug pra retired automaticamente)
Built-in prompts inline em src/lib/prompts.ts: PROMPTS={memoryExtractor, dossierBuilder, personaDistiller, judge}, cada um com slug+content. seedBuiltinPrompts(accountId) cria version 1 status=prod pra cada built-in se não existir.
Template engine: interpolate(template, vars) suporta {{var}} e {{nested.path}} via dot-walk.
UI: /prompts route com SlugGroup expandable mostrando todas versões agrupadas por slug. VersionRow com badge de status, nota de mudança, botões Fork (cria rascunho a partir da versão) e Promover. Conteúdo expandível em pre font-mono.
RLS: select=membro, insert/update/delete=admin. Mesmo padrão de personas/deployments.
```

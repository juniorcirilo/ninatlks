// GERADO por scripts/gen-operations.py — não edite à mão.
export interface OperationDef {
  resource: string;
  value: string;
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** relativo a /accounts/{accountId}; `:param` vira campo do node */
  path: string;
  pathParams: string[];
  query: boolean;
  body: boolean;
}

export const RESOURCES: Array<{ name: string; value: string }> = [
  {
    "name": "Conta",
    "value": "account"
  },
  {
    "name": "Agente (persona)",
    "value": "agent"
  },
  {
    "name": "Fonte de dados do agente",
    "value": "agentSource"
  },
  {
    "name": "Ligação",
    "value": "call"
  },
  {
    "name": "Cadência",
    "value": "cadence"
  },
  {
    "name": "Campanha",
    "value": "campaign"
  },
  {
    "name": "Empresa",
    "value": "company"
  },
  {
    "name": "Compliance (DNC)",
    "value": "compliance"
  },
  {
    "name": "Contato",
    "value": "contact"
  },
  {
    "name": "Lista de contatos",
    "value": "contactList"
  },
  {
    "name": "Conversa",
    "value": "conversation"
  },
  {
    "name": "Dashboard",
    "value": "dashboard"
  },
  {
    "name": "ElevenLabs",
    "value": "elevenlabs"
  },
  {
    "name": "Google Calendar",
    "value": "googleCalendar"
  },
  {
    "name": "Reunião",
    "value": "meeting"
  },
  {
    "name": "Mensagem",
    "value": "message"
  },
  {
    "name": "Notificação",
    "value": "notification"
  },
  {
    "name": "Pipeline",
    "value": "pipeline"
  },
  {
    "name": "Profissional (agenda)",
    "value": "professional"
  },
  {
    "name": "Telefonia",
    "value": "telephony"
  },
  {
    "name": "Webhook de saída",
    "value": "webhook"
  },
  {
    "name": "WhatsApp",
    "value": "whatsapp"
  }
];

export const OPERATIONS: OperationDef[] = [
  {
    "resource": "account",
    "value": "get_account",
    "name": "Obter",
    "method": "GET",
    "path": "/",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "account",
    "value": "patch_account",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "account",
    "value": "get_dialing_settings",
    "name": "Obter configuração de discagem",
    "method": "GET",
    "path": "/dialing-settings",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "account",
    "value": "put_dialing_settings",
    "name": "Salvar configuração de discagem",
    "method": "PUT",
    "path": "/dialing-settings",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "account",
    "value": "get_inboxes",
    "name": "Listar caixas de entrada",
    "method": "GET",
    "path": "/inboxes",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "account",
    "value": "post_integrations_status",
    "name": "Verificar integrações",
    "method": "POST",
    "path": "/integrations-status",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "account",
    "value": "get_my_availability",
    "name": "Obter minha disponibilidade",
    "method": "GET",
    "path": "/my-availability",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "account",
    "value": "put_my_availability",
    "name": "Salvar minha disponibilidade",
    "method": "PUT",
    "path": "/my-availability",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "post_agent_llm_provider_models",
    "name": "Listar modelos de LLM",
    "method": "POST",
    "path": "/agent-llm-provider/models",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "post_agent_llm_provider_test",
    "name": "Testar provedor de LLM",
    "method": "POST",
    "path": "/agent-llm-provider/test",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "post_persona_deployments",
    "name": "Publicar em caixa de entrada",
    "method": "POST",
    "path": "/persona-deployments",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "delete_persona_deployments_by_id",
    "name": "Excluir — DELETE /persona-deployments/:id",
    "method": "DELETE",
    "path": "/persona-deployments/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "agent",
    "value": "get_persona_deployments_active_for_inbox",
    "name": "Obter ativo da caixa de entrada",
    "method": "GET",
    "path": "/persona-deployments/active-for-inbox",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "agent",
    "value": "get_personas",
    "name": "Listar",
    "method": "GET",
    "path": "/personas",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "agent",
    "value": "post_personas",
    "name": "Criar",
    "method": "POST",
    "path": "/personas",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "delete_personas_by_id",
    "name": "Excluir — DELETE /personas/:id",
    "method": "DELETE",
    "path": "/personas/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "agent",
    "value": "patch_personas_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/personas/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "get_personas_deployments_by_id",
    "name": "Listar publicações",
    "method": "GET",
    "path": "/personas/:id/deployments",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "agent",
    "value": "post_personas_distill_by_id",
    "name": "Destilar conhecimento",
    "method": "POST",
    "path": "/personas/:id/distill",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "post_personas_generate_prompt_by_id",
    "name": "Gerar prompt",
    "method": "POST",
    "path": "/personas/:id/generate-prompt",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agent",
    "value": "post_personas_suggest_reply_by_id",
    "name": "Sugerir resposta",
    "method": "POST",
    "path": "/personas/:id/suggest-reply",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agentSource",
    "value": "get_agent_sources",
    "name": "Listar",
    "method": "GET",
    "path": "/agent-sources",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "agentSource",
    "value": "post_agent_sources",
    "name": "Criar",
    "method": "POST",
    "path": "/agent-sources",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "agentSource",
    "value": "delete_agent_sources_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/agent-sources/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "agentSource",
    "value": "patch_agent_sources_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/agent-sources/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agentSource",
    "value": "get_agent_sources_failures_by_id",
    "name": "Listar falhas",
    "method": "GET",
    "path": "/agent-sources/:id/failures",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "agentSource",
    "value": "post_agent_sources_run_by_id",
    "name": "Executar agora",
    "method": "POST",
    "path": "/agent-sources/:id/run",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "agentSource",
    "value": "post_agent_sources_resolve_failure",
    "name": "Resolver falha",
    "method": "POST",
    "path": "/agent-sources/resolve-failure",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "call",
    "value": "get_calls",
    "name": "Listar",
    "method": "GET",
    "path": "/calls",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "call",
    "value": "get_calls_by_id",
    "name": "Obter",
    "method": "GET",
    "path": "/calls/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "call",
    "value": "get_voice_calls",
    "name": "Listar (calls)",
    "method": "GET",
    "path": "/voice/calls",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "call",
    "value": "post_voice_calls",
    "name": "Fazer ligação",
    "method": "POST",
    "path": "/voice/calls",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "call",
    "value": "get_voice_calls_by_id",
    "name": "Obter (calls)",
    "method": "GET",
    "path": "/voice/calls/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "call",
    "value": "post_voice_calls_cancel_by_id",
    "name": "Cancelar ligação",
    "method": "POST",
    "path": "/voice/calls/:id/cancel",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "call",
    "value": "post_voice_calls_reclassify_by_id",
    "name": "Reclassificar",
    "method": "POST",
    "path": "/voice/calls/:id/reclassify",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "call",
    "value": "post_voice_calls_summary_by_id",
    "name": "Gerar resumo",
    "method": "POST",
    "path": "/voice/calls/:id/summary",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "call",
    "value": "post_voice_calls_transcribe_by_id",
    "name": "Refazer transcrição",
    "method": "POST",
    "path": "/voice/calls/:id/transcribe",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "cadence",
    "value": "get_cadences",
    "name": "Listar",
    "method": "GET",
    "path": "/cadences",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "cadence",
    "value": "post_cadences",
    "name": "Criar ou atualizar",
    "method": "POST",
    "path": "/cadences",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "cadence",
    "value": "delete_cadences_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/cadences/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "cadence",
    "value": "post_cadences_enroll_by_id",
    "name": "Inscrever contato",
    "method": "POST",
    "path": "/cadences/:id/enroll",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "get_campaigns",
    "name": "Listar — GET /campaigns",
    "method": "GET",
    "path": "/campaigns",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "post_campaigns",
    "name": "Criar — POST /campaigns",
    "method": "POST",
    "path": "/campaigns",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "delete_campaigns_by_id",
    "name": "Excluir — DELETE /campaigns/:id",
    "method": "DELETE",
    "path": "/campaigns/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_by_id",
    "name": "Obter",
    "method": "GET",
    "path": "/campaigns/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "patch_campaigns_by_id",
    "name": "Atualizar — PATCH /campaigns/:id",
    "method": "PATCH",
    "path": "/campaigns/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_batches_by_id",
    "name": "Listar lotes de inscrição",
    "method": "GET",
    "path": "/campaigns/:id/batches",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "post_campaigns_batches_approve_by_id_batchId",
    "name": "Aprovar lote",
    "method": "POST",
    "path": "/campaigns/:id/batches/:batchId/approve",
    "pathParams": [
      "id",
      "batchId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_batches_preview_by_id_batchId",
    "name": "Pré-visualizar lote",
    "method": "GET",
    "path": "/campaigns/:id/batches/:batchId/preview",
    "pathParams": [
      "id",
      "batchId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "post_campaigns_batches_reject_by_id_batchId",
    "name": "Rejeitar lote",
    "method": "POST",
    "path": "/campaigns/:id/batches/:batchId/reject",
    "pathParams": [
      "id",
      "batchId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "post_campaigns_cancel_calls_by_id",
    "name": "Cancelar ligações em andamento",
    "method": "POST",
    "path": "/campaigns/:id/cancel-calls",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_contacts_by_id",
    "name": "Listar contatos da campanha",
    "method": "GET",
    "path": "/campaigns/:id/contacts",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "post_campaigns_export_by_id",
    "name": "Exportar CSV",
    "method": "POST",
    "path": "/campaigns/:id/export",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "post_campaigns_retry_failed_by_id",
    "name": "Tentar novamente (falhas)",
    "method": "POST",
    "path": "/campaigns/:id/retry-failed",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "patch_campaigns_status_by_id",
    "name": "Alterar status",
    "method": "PATCH",
    "path": "/campaigns/:id/status",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_contact_lists",
    "name": "Listar listas de contatos",
    "method": "GET",
    "path": "/campaigns/contact-lists",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_personas",
    "name": "Listar agentes disponíveis",
    "method": "GET",
    "path": "/campaigns/personas",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "get_campaigns_phone_numbers",
    "name": "Listar números disponíveis",
    "method": "GET",
    "path": "/campaigns/phone-numbers",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "get_retention_rules",
    "name": "Listar — GET /retention-rules",
    "method": "GET",
    "path": "/retention-rules",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "post_retention_rules",
    "name": "Criar — POST /retention-rules",
    "method": "POST",
    "path": "/retention-rules",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "campaign",
    "value": "delete_retention_rules_by_id",
    "name": "Excluir — DELETE /retention-rules/:id",
    "method": "DELETE",
    "path": "/retention-rules/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "campaign",
    "value": "patch_retention_rules_by_id",
    "name": "Atualizar — PATCH /retention-rules/:id",
    "method": "PATCH",
    "path": "/retention-rules/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "company",
    "value": "delete_companies",
    "name": "Excluir todas",
    "method": "DELETE",
    "path": "/companies",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "get_companies",
    "name": "Listar",
    "method": "GET",
    "path": "/companies",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "post_companies",
    "name": "Criar",
    "method": "POST",
    "path": "/companies",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "company",
    "value": "delete_companies_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/companies/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "get_companies_by_id",
    "name": "Obter",
    "method": "GET",
    "path": "/companies/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "patch_companies_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/companies/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "company",
    "value": "get_companies_contacts_by_id",
    "name": "Listar contatos",
    "method": "GET",
    "path": "/companies/:id/contacts",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "get_companies_clients",
    "name": "Listar clientes",
    "method": "GET",
    "path": "/companies/clients",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "company",
    "value": "post_companies_link",
    "name": "Vincular contato",
    "method": "POST",
    "path": "/companies/link",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "company",
    "value": "post_companies_link_import",
    "name": "Vincular contatos (importação)",
    "method": "POST",
    "path": "/companies/link/import",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "compliance",
    "value": "get_compliance_policy",
    "name": "Obter",
    "method": "GET",
    "path": "/compliance-policy",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "compliance",
    "value": "put_compliance_policy",
    "name": "Salvar",
    "method": "PUT",
    "path": "/compliance-policy",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "compliance",
    "value": "get_dnc",
    "name": "Listar",
    "method": "GET",
    "path": "/dnc",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "compliance",
    "value": "post_dnc",
    "name": "Adicionar",
    "method": "POST",
    "path": "/dnc",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "compliance",
    "value": "delete_dnc_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/dnc/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "get_contacts",
    "name": "Listar",
    "method": "GET",
    "path": "/contacts",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "post_contacts",
    "name": "Criar",
    "method": "POST",
    "path": "/contacts",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "patch_contacts_by_id",
    "name": "Atualizar dados operacionais",
    "method": "PATCH",
    "path": "/contacts/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "delete_contacts_lgpd_by_id",
    "name": "Excluir dados (LGPD)",
    "method": "DELETE",
    "path": "/contacts/:id/lgpd",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "get_contacts_timeline_by_id",
    "name": "Linha do tempo",
    "method": "GET",
    "path": "/contacts/:id/timeline",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "get_contacts_variables_by_id",
    "name": "Obter variáveis",
    "method": "GET",
    "path": "/contacts/:id/variables",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "patch_contacts_variables_by_id",
    "name": "Salvar variáveis",
    "method": "PATCH",
    "path": "/contacts/:id/variables",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_campaign",
    "name": "Em massa: adicionar à campanha",
    "method": "POST",
    "path": "/contacts/bulk/campaign",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_lifecycle",
    "name": "Em massa: definir ciclo de vida",
    "method": "POST",
    "path": "/contacts/bulk/lifecycle",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_operational_status",
    "name": "Em massa: definir status operacional",
    "method": "POST",
    "path": "/contacts/bulk/operational-status",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_owner",
    "name": "Em massa: atribuir responsável",
    "method": "POST",
    "path": "/contacts/bulk/owner",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_round_robin",
    "name": "Em massa: distribuir (round-robin)",
    "method": "POST",
    "path": "/contacts/bulk/round-robin",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_bulk_tag",
    "name": "Em massa: adicionar tag",
    "method": "POST",
    "path": "/contacts/bulk/tag",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "get_contacts_candidates",
    "name": "Listar candidatos",
    "method": "GET",
    "path": "/contacts/candidates",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "get_contacts_editable_campaigns",
    "name": "Campanhas editáveis",
    "method": "GET",
    "path": "/contacts/editable-campaigns",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "post_contacts_import",
    "name": "Importar CSV",
    "method": "POST",
    "path": "/contacts/import",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "post_contacts_merge",
    "name": "Mesclar contatos",
    "method": "POST",
    "path": "/contacts/merge",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contact",
    "value": "get_contacts_productivity",
    "name": "Produtividade",
    "method": "GET",
    "path": "/contacts/productivity",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contact",
    "value": "get_contacts_tags_suggestions",
    "name": "Sugestões de tags",
    "method": "GET",
    "path": "/contacts/tags/suggestions",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "get_contact_lists",
    "name": "Listar",
    "method": "GET",
    "path": "/contact-lists",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "post_contact_lists",
    "name": "Criar",
    "method": "POST",
    "path": "/contact-lists",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "contactList",
    "value": "delete_contact_lists_by_listId",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/contact-lists/:listId",
    "pathParams": [
      "listId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "get_contact_lists_by_listId",
    "name": "Obter",
    "method": "GET",
    "path": "/contact-lists/:listId",
    "pathParams": [
      "listId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "patch_contact_lists_by_listId",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/contact-lists/:listId",
    "pathParams": [
      "listId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "contactList",
    "value": "get_contact_lists_documents_by_listId",
    "name": "Listar documentos",
    "method": "GET",
    "path": "/contact-lists/:listId/documents",
    "pathParams": [
      "listId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "get_contact_lists_members_by_listId",
    "name": "Listar membros",
    "method": "GET",
    "path": "/contact-lists/:listId/members",
    "pathParams": [
      "listId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "contactList",
    "value": "post_contact_lists_members_by_listId",
    "name": "Adicionar membros",
    "method": "POST",
    "path": "/contact-lists/:listId/members",
    "pathParams": [
      "listId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "conversation",
    "value": "get_conversations",
    "name": "Listar",
    "method": "GET",
    "path": "/conversations",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "conversation",
    "value": "patch_conversations_by_conversationId",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/conversations/:conversationId",
    "pathParams": [
      "conversationId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "conversation",
    "value": "get_conversations_messages_by_conversationId",
    "name": "Listar mensagens",
    "method": "GET",
    "path": "/conversations/:conversationId/messages",
    "pathParams": [
      "conversationId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "conversation",
    "value": "post_conversations_start",
    "name": "Iniciar (start)",
    "method": "POST",
    "path": "/conversations/start",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "dashboard",
    "value": "get_dashboards_agent_analytics",
    "name": "Analytics do agente",
    "method": "GET",
    "path": "/dashboards/agent-analytics",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "dashboard",
    "value": "get_dashboards_mission_control",
    "name": "Mission control",
    "method": "GET",
    "path": "/dashboards/mission-control",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "dashboard",
    "value": "get_dashboards_sdr_snapshot",
    "name": "Painel SDR",
    "method": "GET",
    "path": "/dashboards/sdr-snapshot",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "elevenlabs",
    "value": "get_elevenlabs_agent_info_by_agentId",
    "name": "Obter agente na ElevenLabs",
    "method": "GET",
    "path": "/elevenlabs/agent-info/:agentId",
    "pathParams": [
      "agentId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "elevenlabs",
    "value": "post_elevenlabs_agent_sync",
    "name": "Sincronizar agente com ElevenLabs",
    "method": "POST",
    "path": "/elevenlabs/agent-sync",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "elevenlabs",
    "value": "post_elevenlabs_call_audio",
    "name": "Obter áudio da ligação",
    "method": "POST",
    "path": "/elevenlabs/call-audio",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "elevenlabs",
    "value": "post_elevenlabs_kb_add",
    "name": "Adicionar base de conhecimento",
    "method": "POST",
    "path": "/elevenlabs/kb-add",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "elevenlabs",
    "value": "post_elevenlabs_preview",
    "name": "Prévia de voz",
    "method": "POST",
    "path": "/elevenlabs/preview",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "elevenlabs",
    "value": "get_elevenlabs_voices",
    "name": "Listar (voices)",
    "method": "GET",
    "path": "/elevenlabs/voices",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "elevenlabs",
    "value": "delete_elevenlabs_voices_by_voiceId",
    "name": "Excluir (voices)",
    "method": "DELETE",
    "path": "/elevenlabs/voices/:voiceId",
    "pathParams": [
      "voiceId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "elevenlabs",
    "value": "patch_elevenlabs_voices_settings_by_voiceId",
    "name": "Atualizar ajustes da voz",
    "method": "PATCH",
    "path": "/elevenlabs/voices/:voiceId/settings",
    "pathParams": [
      "voiceId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "googleCalendar",
    "value": "delete_google_calendar",
    "name": "Desconectar",
    "method": "DELETE",
    "path": "/google-calendar",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "googleCalendar",
    "value": "get_google_calendar_status",
    "name": "Ver status",
    "method": "GET",
    "path": "/google-calendar/status",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "meeting",
    "value": "get_availability",
    "name": "Obter",
    "method": "GET",
    "path": "/availability",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "meeting",
    "value": "put_availability",
    "name": "Salvar",
    "method": "PUT",
    "path": "/availability",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "meeting",
    "value": "get_meetings",
    "name": "Listar",
    "method": "GET",
    "path": "/meetings",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "meeting",
    "value": "post_meetings",
    "name": "Criar",
    "method": "POST",
    "path": "/meetings",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "meeting",
    "value": "delete_meetings_by_id",
    "name": "Cancelar",
    "method": "DELETE",
    "path": "/meetings/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "meeting",
    "value": "patch_meetings_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/meetings/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "meeting",
    "value": "patch_meetings_outcome_by_id",
    "name": "Registrar resultado",
    "method": "PATCH",
    "path": "/meetings/:id/outcome",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "meeting",
    "value": "patch_meetings_reschedule_by_id",
    "name": "Reagendar",
    "method": "PATCH",
    "path": "/meetings/:id/reschedule",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "message",
    "value": "post_messages_send",
    "name": "Enviar (send)",
    "method": "POST",
    "path": "/messages/send",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "notification",
    "value": "get_notifications",
    "name": "Listar",
    "method": "GET",
    "path": "/notifications",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "notification",
    "value": "patch_notifications_read_by_id",
    "name": "Marcar como lida",
    "method": "PATCH",
    "path": "/notifications/:id/read",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "notification",
    "value": "post_notifications_read_all",
    "name": "Marcar todas como lidas",
    "method": "POST",
    "path": "/notifications/read-all",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "notification",
    "value": "get_notifications_unread_count",
    "name": "Contar não lidas",
    "method": "GET",
    "path": "/notifications/unread-count",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "pipeline",
    "value": "get_pipeline",
    "name": "Obter",
    "method": "GET",
    "path": "/pipeline",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "pipeline",
    "value": "post_pipeline_leads_move_by_contactId",
    "name": "Mover lead de etapa",
    "method": "POST",
    "path": "/pipeline/leads/:contactId/move",
    "pathParams": [
      "contactId"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "professional",
    "value": "get_doctors",
    "name": "Listar",
    "method": "GET",
    "path": "/doctors",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "professional",
    "value": "post_doctors",
    "name": "Criar",
    "method": "POST",
    "path": "/doctors",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "professional",
    "value": "delete_doctors_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/doctors/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "professional",
    "value": "patch_doctors_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/doctors/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "professional",
    "value": "put_doctors_availability_by_id",
    "name": "Salvar disponibilidade",
    "method": "PUT",
    "path": "/doctors/:id/availability",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "get_phone_numbers",
    "name": "Listar",
    "method": "GET",
    "path": "/phone-numbers",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "telephony",
    "value": "post_phone_numbers",
    "name": "Criar",
    "method": "POST",
    "path": "/phone-numbers",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "delete_phone_numbers_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/phone-numbers/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "telephony",
    "value": "patch_phone_numbers_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/phone-numbers/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "post_phone_numbers_activate_elevenlabs_by_id",
    "name": "Ativar na ElevenLabs",
    "method": "POST",
    "path": "/phone-numbers/:id/activate-elevenlabs",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "post_twilio_numbers_buy",
    "name": "Comprar número",
    "method": "POST",
    "path": "/twilio/numbers/buy",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "post_twilio_numbers_import",
    "name": "Importar número",
    "method": "POST",
    "path": "/twilio/numbers/import",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "telephony",
    "value": "get_twilio_numbers_owned",
    "name": "Listar números da conta",
    "method": "GET",
    "path": "/twilio/numbers/owned",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "telephony",
    "value": "get_twilio_numbers_search",
    "name": "Buscar números",
    "method": "GET",
    "path": "/twilio/numbers/search",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "telephony",
    "value": "post_voice_clone",
    "name": "Clonar voz",
    "method": "POST",
    "path": "/voice-clone",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "webhook",
    "value": "get_webhook_deliveries",
    "name": "Listar — GET /webhook-deliveries",
    "method": "GET",
    "path": "/webhook-deliveries",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "webhook",
    "value": "get_webhook_endpoints",
    "name": "Listar — GET /webhook-endpoints",
    "method": "GET",
    "path": "/webhook-endpoints",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "webhook",
    "value": "post_webhook_endpoints",
    "name": "Criar",
    "method": "POST",
    "path": "/webhook-endpoints",
    "pathParams": [],
    "query": false,
    "body": true
  },
  {
    "resource": "webhook",
    "value": "delete_webhook_endpoints_by_id",
    "name": "Excluir",
    "method": "DELETE",
    "path": "/webhook-endpoints/:id",
    "pathParams": [
      "id"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "webhook",
    "value": "patch_webhook_endpoints_by_id",
    "name": "Atualizar",
    "method": "PATCH",
    "path": "/webhook-endpoints/:id",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "webhook",
    "value": "post_webhook_endpoints_rotate_secret_by_id",
    "name": "Rotacionar segredo",
    "method": "POST",
    "path": "/webhook-endpoints/:id/rotate-secret",
    "pathParams": [
      "id"
    ],
    "query": false,
    "body": true
  },
  {
    "resource": "whatsapp",
    "value": "get_whatsapp",
    "name": "Listar",
    "method": "GET",
    "path": "/whatsapp",
    "pathParams": [],
    "query": true,
    "body": false
  },
  {
    "resource": "whatsapp",
    "value": "delete_whatsapp_channels_by_channelId",
    "name": "Excluir (channels)",
    "method": "DELETE",
    "path": "/whatsapp/channels/:channelId",
    "pathParams": [
      "channelId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "whatsapp",
    "value": "get_whatsapp_channels_qrcode_by_channelId",
    "name": "Obter QR code",
    "method": "GET",
    "path": "/whatsapp/channels/:channelId/qrcode",
    "pathParams": [
      "channelId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "whatsapp",
    "value": "get_whatsapp_channels_status_by_channelId",
    "name": "Ver status",
    "method": "GET",
    "path": "/whatsapp/channels/:channelId/status",
    "pathParams": [
      "channelId"
    ],
    "query": true,
    "body": false
  },
  {
    "resource": "whatsapp",
    "value": "post_whatsapp_channels",
    "name": "Criar sessão",
    "method": "POST",
    "path": "/whatsapp/channels",
    "pathParams": [],
    "query": false,
    "body": true
  }
];

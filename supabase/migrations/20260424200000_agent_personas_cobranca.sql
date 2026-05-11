-- ============================================================
-- cobrAI · ajustes em agent_personas pra contexto de cobrança
-- ============================================================
-- source_user_id foi desenhado no Nexus pra "clonar estilo de um humano".
-- Em cobrança não faz sentido forçar — o agente é genérico da credora.
-- Relaxa pra nullable.

alter table public.agent_personas
  alter column source_user_id drop not null;

import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260518203844_5d4e78bf-da7c-4cee-89ac-d638a55cc7a6.sql.
export class Migration20260518203844 implements MigrationInterface {
  name = 'Migration20260518203844';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE VIEW public.v_conversation_timeline
WITH (security_invoker = true) AS
SELECT
  m.account_id,
  m.conversation_id,
  m.id                                AS item_id,
  'message'::text                     AS kind,
  m.created_at                        AS occurred_at,
  jsonb_build_object(
    'content',        m.content,
    'message_type',   m.message_type,
    'private',        m.private,
    'sender_type',    m.sender_type,
    'sender_id',      m.sender_id,
    'content_type',   m.content_type,
    'attributes',     m.content_attributes
  )                                   AS payload
FROM public.messages m

UNION ALL

SELECT
  vc.account_id,
  vc.conversation_id,
  vc.id                               AS item_id,
  'voice_call'::text                  AS kind,
  vc.created_at                       AS occurred_at,
  jsonb_build_object(
    'direction',         vc.direction,
    'status',            vc.status,
    'duration_seconds',  vc.duration_seconds,
    'from_number',       vc.from_number,
    'to_number',         vc.to_number,
    'recording_url',     vc.recording_url
  )                                   AS payload
FROM public.voice_calls vc
WHERE vc.conversation_id IS NOT NULL

UNION ALL

SELECT
  sm.account_id,
  NULL::uuid                          AS conversation_id,
  sm.id                               AS item_id,
  'meeting'::text                     AS kind,
  sm.starts_at                        AS occurred_at,
  jsonb_build_object(
    'title',        sm.title,
    'starts_at',    sm.starts_at,
    'ends_at',      sm.ends_at,
    'status',       sm.status,
    'provider',     sm.provider,
    'invitee_name', sm.invitee_name,
    'contact_id',   sm.contact_id,
    'briefing',     sm.briefing
  )                                   AS payload
FROM public.scheduled_meetings sm

UNION ALL

SELECT
  ah.account_id,
  ah.conversation_id,
  ah.id                               AS item_id,
  'handoff'::text                     AS kind,
  ah.created_at                       AS occurred_at,
  jsonb_build_object(
    'from_persona_id', ah.from_persona_id,
    'to_persona_id',   ah.to_persona_id,
    'reason',          ah.reason,
    'context',         ah.context
  )                                   AS payload
FROM public.agent_handoffs ah;
`);
    await queryRunner.query(`
GRANT SELECT ON public.v_conversation_timeline TO authenticated;
`);
    await queryRunner.query(`
COMMENT ON VIEW public.v_conversation_timeline IS
  'Linha do tempo unificada por conversa (Fase 1B): mensagens, chamadas, reuniões e handoffs em ordem cronológica. security_invoker garante RLS das tabelas-base.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260518203844 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

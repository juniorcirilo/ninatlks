import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chamadas transferidas (escaladas) pelo agente eram contadas como
 * 'atendida' nos contatos de campanha porque voice_campaign_contact_disposition
 * não tinha o case 'escalada'. O resultado: escalated_count em voice_campaigns
 * nunca subia e a distinção entre "atendeu e conversou" versus "atendeu e pediu
 * um humano" ficava invisível no funil.
 *
 * Esta migration adiciona o case 'escalada' ao vocabulário de desfecho.
 * Chamadas de transferência agora:
 *   - Gravam outcome = 'escalada' em voice_campaign_contacts
 *   - Definem status = 'escalated' em voice_campaign_contacts
 *   - Incrementam escalated_count (e não connected_count) em voice_campaigns
 */
export class CampaignContactEscalatedDisposition20260928010000
  implements MigrationInterface
{
  name = 'CampaignContactEscalatedDisposition20260928010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.voice_campaign_contact_disposition(
  _id bigint,
  _outcome text,
  _duration_sec integer default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_campaign_id uuid;
  v_current text;
  v_connected int := 0;
  v_escalated int := 0;
  v_voicemail int := 0;
  v_failed int := 0;
begin
  select status, campaign_id into v_current, v_campaign_id
    from public.voice_campaign_contacts where id = _id;
  if v_current is null then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;
  -- Só age sobre contato ainda em voo (mesmo guard da versão anterior).
  if v_current not in ('placed','ringing','connected') then
    return jsonb_build_object('applied', false, 'reason', 'not_in_flight',
      'status', v_current);
  end if;

  case _outcome
    when 'atendida'        then v_status := 'completed'; v_connected := 1;
    when 'escalada'        then v_status := 'escalated'; v_escalated := 1;
    when 'caixa_postal'    then v_status := 'voicemail';  v_voicemail := 1;
    when 'nao_atendeu'     then v_status := 'failed';     v_failed := 1;
    when 'recusada'        then v_status := 'failed';     v_failed := 1;
    when 'falha_operadora' then v_status := 'failed';     v_failed := 1;
    when 'nao_completou'   then v_status := 'failed';     v_failed := 1;
    when 'cancelada'       then v_status := 'canceled';
    else return jsonb_build_object('applied', false, 'reason', 'unknown_outcome',
      'outcome', _outcome);
  end case;

  update public.voice_campaign_contacts
     set status = v_status,
         outcome = _outcome,
         call_duration_sec = coalesce(_duration_sec, call_duration_sec),
         finished_at = now(),
         updated_at = now()
   where id = _id;

  if v_campaign_id is not null then
    perform public.bump_voice_campaign_totals(
      v_campaign_id, 0, v_connected, v_escalated, v_voicemail, v_failed);
  end if;

  return jsonb_build_object('applied', true, 'status', v_status,
    'outcome', _outcome);
end;
$function$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura a versão sem o case 'escalada'
    await queryRunner.query(`
create or replace function public.voice_campaign_contact_disposition(
  _id bigint,
  _outcome text,
  _duration_sec integer default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_campaign_id uuid;
  v_current text;
  v_connected int := 0;
  v_voicemail int := 0;
  v_failed int := 0;
begin
  select status, campaign_id into v_current, v_campaign_id
    from public.voice_campaign_contacts where id = _id;
  if v_current is null then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;
  if v_current not in ('placed','ringing','connected') then
    return jsonb_build_object('applied', false, 'reason', 'not_in_flight',
      'status', v_current);
  end if;

  case _outcome
    when 'atendida'        then v_status := 'completed'; v_connected := 1;
    when 'caixa_postal'    then v_status := 'voicemail';  v_voicemail := 1;
    when 'nao_atendeu'     then v_status := 'failed';     v_failed := 1;
    when 'recusada'        then v_status := 'failed';     v_failed := 1;
    when 'falha_operadora' then v_status := 'failed';     v_failed := 1;
    when 'nao_completou'   then v_status := 'failed';     v_failed := 1;
    when 'cancelada'       then v_status := 'canceled';
    else return jsonb_build_object('applied', false, 'reason', 'unknown_outcome',
      'outcome', _outcome);
  end case;

  update public.voice_campaign_contacts
     set status = v_status,
         outcome = _outcome,
         call_duration_sec = coalesce(_duration_sec, call_duration_sec),
         finished_at = now(),
         updated_at = now()
   where id = _id;

  if v_campaign_id is not null then
    perform public.bump_voice_campaign_totals(
      v_campaign_id, 0, v_connected, 0, v_voicemail, v_failed);
  end if;

  return jsonb_build_object('applied', true, 'status', v_status,
    'outcome', _outcome);
end;
$function$;
`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registra o desfecho telefônico de um contato de campanha.
 *
 * Antes, nada escrevia 'connected'/'voicemail'/'completed' em
 * voice_campaign_contacts: o dispatcher só marcava 'placed' (ou 'failed' em
 * erro de discagem), e a única promoção adiante vinha da classificação por IA
 * — que exige transcrição e portanto só roda em ligação **atendida**. Chamada
 * não atendida, ocupada ou recusada ficava presa em 'placed' pra sempre, e as
 * linhas "Atendidas", "Concluídas" e "Caixa postal" do funil nunca saíam de
 * zero.
 *
 * A Twilio (webhook de status) e a ElevenLabs (finalização da conversa)
 * reportam o desfecho por caminhos diferentes e podem chegar os dois, em
 * qualquer ordem. Por isso esta função é idempotente: só age se o contato
 * ainda estiver num estado não-terminal, e incrementa o contador da campanha
 * uma única vez.
 */
export class CampaignContactDisposition20260727180000
  implements MigrationInterface
{
  name = 'CampaignContactDisposition20260727180000';

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
  v_voicemail int := 0;
  v_failed int := 0;
begin
  select status, campaign_id into v_current, v_campaign_id
    from public.voice_campaign_contacts where id = _id;
  if v_current is null then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;
  -- Só age sobre contato ainda em voo. Fora dessa lista há dois casos, e
  -- ambos devem ser preservados: terminal já registrado (não recontabiliza) e,
  -- crucialmente, 'queued' — que significa que o smart retry reenfileirou o
  -- contato para nova tentativa. Marcar terminal aqui mataria o retry.
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.voice_campaign_contact_disposition(bigint, text, integer);`,
    );
  }
}

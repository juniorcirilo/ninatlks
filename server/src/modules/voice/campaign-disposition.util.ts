import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Vocabulário único de desfecho de ligação de campanha. A UI traduz estes
 * códigos para rótulo; o banco os grava em voice_campaign_contacts.outcome.
 */
export type CallDisposition =
  | 'atendida'
  | 'escalada'
  | 'caixa_postal'
  | 'nao_atendeu'
  | 'recusada'
  | 'falha_operadora'
  | 'nao_completou'
  | 'cancelada';

const logger = new Logger('CampaignDisposition');

/**
 * Traduz o status terminal da Twilio (já mapeado por handleStatus) em
 * desfecho. `answeredBy` vem do AMD da Twilio quando habilitado.
 *
 * 'busy' vira 'recusada' e não 'ocupada' de propósito: do ponto de vista da
 * operação, linha ocupada e recusa explícita têm a mesma consequência — o
 * cliente não falou com o agente e vale outra tentativa depois.
 */
export function dispositionFromTwilioStatus(
  mappedStatus: string,
  durationSec: number,
  answeredBy?: string | null,
): CallDisposition | null {
  if (answeredBy && answeredBy.startsWith('machine')) return 'caixa_postal';
  switch (mappedStatus) {
    case 'completed':
      // A Twilio marca 'completed' toda vez que a ligação encerra sem erro,
      // inclusive quando ninguém atendeu e o tronco derrubou: a duração é o
      // que separa conversa de chamada que só existiu no papel.
      return durationSec > 0 ? 'atendida' : 'nao_completou';
    case 'busy':
      return 'recusada';
    case 'no_answer':
      return 'nao_atendeu';
    case 'failed':
      return 'falha_operadora';
    case 'canceled':
      return 'cancelada';
    default:
      return null; // não-terminal: ringing/in_progress/queued
  }
}

/**
 * Desfecho a partir do que a ElevenLabs reporta ao finalizar a conversa.
 * É o caminho que cobre as ligações originadas por lá (campanha), onde o
 * StatusCallback da Twilio é configurado pela EL e não chega até nós.
 */
export function dispositionFromElevenLabs(
  elStatus: string,
  durationSec: number | null,
  transcriptTurns: number,
): CallDisposition {
  // el_status é o veredito da própria EL sobre a conversa — diferente do
  // status de telefonia (Twilio), que só enxerga a perna do telefone e marca
  // 'completed' mesmo quando a EL encerrou a conversa em erro. Checa isso
  // primeiro e ignora turno/duração: uma conversa que a EL marcou como
  // 'failed' não é prova de conclusão só porque teve turnos — é sinal de que
  // ela caiu no meio (sem turno de fechamento do agente), o que também
  // acontece com transcrição vazia (nunca chegou a começar a trocar turnos).
  if (elStatus === 'failed') {
    return transcriptTurns > 0 ? 'nao_completou' : 'falha_operadora';
  }
  // Turno na transcrição é prova de que houve conversa, e basta sozinho: a
  // duração vem de campos que a EL nem sempre preenche
  // (metadata.call_duration_secs / duration_seconds), e exigir os dois
  // rotularia uma ligação realmente atendida como 'nao_completou' só porque o
  // provedor não reportou o tempo.
  if (transcriptTurns > 0) return 'atendida';
  if ((durationSec ?? 0) > 0) return 'atendida';
  // Sem turno e sem duração: discou, mas ninguém do outro lado entrou na
  // conversa. É o que acontece, por exemplo, quando a chamada morre no aviso
  // de conta trial da Twilio antes do agente assumir.
  return 'nao_completou';
}

/**
 * Aplica o desfecho no contato de campanha ligado a esta voice_call, se
 * houver. Idempotente do lado do banco — chamar duas vezes (Twilio e EL) não
 * duplica contador.
 */
export async function applyCampaignDisposition(
  dataSource: DataSource,
  campaignContactId: string | number | null | undefined,
  disposition: CallDisposition | null,
  durationSec: number | null,
): Promise<void> {
  if (!campaignContactId || !disposition) return;
  try {
    const rows = await dataSource.query<{ applied: unknown }[]>(
      `SELECT public.voice_campaign_contact_disposition($1, $2, $3) AS applied`,
      [campaignContactId, disposition, durationSec],
    );
    logger.log(
      `contato ${campaignContactId} → ${disposition}: ${JSON.stringify(rows[0]?.applied)}`,
    );
  } catch (err) {
    // Nunca derruba a finalização da ligação por causa do registro de
    // desfecho: o dado principal (voice_calls) já foi gravado.
    logger.error(
      `falha ao aplicar desfecho em ${campaignContactId}: ${(err as Error).message}`,
    );
  }
}

/**
 * Avança a execução de cadência que estava esperando o resultado desta
 * ligação (cadence-tick.processor.ts marca `waiting_call_id`/status='running'
 * no lugar de avançar cego no disparo). Só 'atendida' conta como sucesso —
 * caixa postal/não completou/falha de operadora avançam a cadência mas
 * registram o motivo, e fecham a cadência como 'failed' em vez de
 * 'completed' se for o último step.
 */
export async function applyCadenceDisposition(
  dataSource: DataSource,
  cadenceExecutionId: string | null | undefined,
  disposition: CallDisposition | null,
): Promise<void> {
  if (!cadenceExecutionId || !disposition) return;
  try {
    await dataSource.query(`SELECT public.cadence_advance($1, $2, $3)`, [
      cadenceExecutionId,
      disposition === 'atendida',
      disposition,
    ]);
    logger.log(`cadência ${cadenceExecutionId} → ${disposition}`);
  } catch (err) {
    logger.error(
      `falha ao avançar cadência ${cadenceExecutionId}: ${(err as Error).message}`,
    );
  }
}

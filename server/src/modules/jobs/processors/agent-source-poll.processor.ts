import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AgentSourcesService } from '../../ingest/agent-sources.service';

/**
 * Busca ativa das fontes de dados por agente.
 *
 * O tick roda de minuto em minuto e só pega quem está vencido pelo próprio
 * `schedule_minutes` — a fila não conhece o intervalo de cada fonte, quem
 * decide é a linha. Fonte sem agendamento nunca aparece aqui: ela existe só
 * para o botão Sincronizar.
 *
 * Falha de uma fonte não derruba as outras, e nem precisa ser propagada: o
 * `run` já grava `last_status`/`last_error` na linha, que é o que a tela
 * mostra. Retentar aqui só adiantaria a próxima janela.
 */
@Processor('agent-source-poll')
export class AgentSourcePollProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentSourcePollProcessor.name);

  constructor(private readonly sources: AgentSourcesService) {
    super();
  }

  async process(job: Job): Promise<{ ran: number }> {
    const due = await this.sources.listDue();
    if (due.length === 0) return { ran: 0 };

    this.logger.log(`agent-source-poll (job ${job.id}): ${due.length} fonte(s)`);
    let ran = 0;
    for (const source of due) {
      try {
        await this.sources.run(source.id);
        ran++;
      } catch (err) {
        // Conflito de trava é esperado: o operador pode ter clicado
        // Sincronizar no mesmo instante. Segue para a próxima fonte.
        this.logger.warn(
          `fonte ${source.name} não rodou: ${(err as Error).message}`,
        );
      }
    }
    return { ran };
  }
}

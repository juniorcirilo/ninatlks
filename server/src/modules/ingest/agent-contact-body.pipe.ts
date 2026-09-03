import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IngestAgentContactDto } from './dto/ingest-agent-contact.dto';

/** Teto por requisição. Acima disso o chamador pagina. */
const MAX_BATCH = 500;

export interface AgentContactBody {
  /** true quando o corpo veio como array — muda o formato da resposta. */
  batch: boolean;
  rows: IngestAgentContactDto[];
}

/**
 * Aceita `{…}` ou `[{…}, {…}]` no mesmo endpoint.
 *
 * O ValidationPipe global não resolve isto: ele valida contra *uma* classe
 * declarada no parâmetro, e aqui o corpo tem duas formas legítimas. Então o
 * parâmetro é um tipo estrutural (que o ValidationPipe ignora, porque o
 * metatype vira Object) e a validação de cada linha acontece aqui, com o
 * índice da linha na mensagem — em lote de 300, "phone must be a string" sem
 * dizer *onde* não ajuda ninguém.
 */
@Injectable()
export class AgentContactBodyPipe
  implements PipeTransform<unknown, Promise<AgentContactBody>>
{
  async transform(value: unknown): Promise<AgentContactBody> {
    const batch = Array.isArray(value);
    const raw = (batch ? value : [value]) as unknown[];

    if (raw.length === 0) {
      throw new BadRequestException('Envie ao menos um contato.');
    }
    if (raw.length > MAX_BATCH) {
      throw new BadRequestException(
        `Máximo de ${MAX_BATCH} contatos por requisição, recebidos ${raw.length}. Pagine o lote — a operação é insert-only e idempotente pelo telefone (contato existente é só ignorado).`,
      );
    }

    const rows: IngestAgentContactDto[] = [];
    for (const [index, item] of raw.entries()) {
      const where = batch ? `linha ${index}: ` : '';
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(`${where}esperado um objeto JSON.`);
      }

      const dto = plainToInstance(IngestAgentContactDto, item);
      const errors = await validate(dto, { whitelist: true });
      if (errors.length > 0) {
        const detail = errors
          .flatMap((e) => Object.values(e.constraints ?? {}))
          .join('; ');
        throw new BadRequestException(`${where}${detail}`);
      }
      rows.push(dto);
    }

    return { batch, rows };
  }
}

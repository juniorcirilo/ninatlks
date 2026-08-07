import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Query de `GET /contacts/candidates` — o conjunto que "criar lista sem CSV"
 * usa como ponto de partida.
 */
export class ListCandidatesQueryDto {
  @IsOptional()
  @IsUUID()
  stageId?: string;

  /**
   * Em true (padrão), contato que já é membro de qualquer lista fica de fora.
   * Sem isso, "sem filtro, importa todos os contatos com telefone" varria a
   * conta inteira — inclusive quem já pertence a uma lista operacional
   * alimentada por webhook (ex.: Sofia SDR, Larissa, Diego Cobrança),
   * misturando públicos que deveriam ser exclusivos de cada agente.
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? true : value === 'true' || value === true,
  )
  @IsBoolean()
  excludeListed?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(20000)
  limit?: number;
}

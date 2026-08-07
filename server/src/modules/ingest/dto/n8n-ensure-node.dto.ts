import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Corpo mínimo para pedir o nó do agente no n8n. Sem `agentId`/`sourceId` de
 * propósito: no fluxo de "Configurar" a fonte ainda não existe no nosso banco
 * quando este nó é criado — o nome do agente é tudo que o n8n precisa para
 * nomear o nó e decidir se ele já existe.
 */
export class N8nEnsureNodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  agentName!: string;

  @IsOptional()
  @IsIn(['GET', 'POST'])
  method?: 'GET' | 'POST';
}

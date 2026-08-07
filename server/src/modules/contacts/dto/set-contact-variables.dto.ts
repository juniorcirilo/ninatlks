import { IsObject, IsString } from 'class-validator';

/**
 * Chave/valor livres — mesmo formato de `custom_attributes.ingest_variables`.
 * Sem whitelist de chaves de propósito: cada conta define suas próprias
 * variáveis de fala (ex.: "parcela", "valor_devedor_saldo"), não há um
 * catálogo fixo pra validar contra.
 */
export class SetContactVariablesDto {
  @IsObject()
  variables!: Record<string, string>;
}

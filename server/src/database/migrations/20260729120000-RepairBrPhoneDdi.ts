import { Logger } from '@nestjs/common';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conserta os telefones gravados sem DDI pelo import/criação de contato.
 *
 * Até agora esses dois caminhos normalizavam telefone com
 * `'+' + só_os_dígitos` (contacts.service.ts), então a base de ERP/CSV — que
 * vem sem DDI — produzia "11987654321" → "+11987654321". Isso não é o celular
 * de São Paulo: é um +1 (EUA) impossível de discar. O código agora usa
 * toE164(..., 'BR'), mas as linhas já gravadas continuam quebradas, e como o
 * `identifier` também deriva do telefone, reimportar a mesma base criaria um
 * contato novo em vez de casar com o existente.
 *
 * O reparo é deliberadamente estreito. Só toca a linha quando tudo isto vale:
 *
 *  1. `identifier = 'phone:' || dígitos` — prova que veio do import/criação.
 *     Contato de SMS, WhatsApp (Evolution) e agent-tools usa prefixo próprio
 *     ('sms:', 'evolution:whatsapp:'), e esses caminhos já normalizavam certo;
 *  2. 10 ou 11 dígitos, que é exatamente o formato nacional sem DDI;
 *  3. DDD plausível (dois dígitos, nenhum deles 0) e, em celular de 11
 *     dígitos, o nono dígito = 9;
 *  4. ainda não existe outro contato na mesma conta com o número corrigido —
 *     se existir, a linha quebrada é deixada como está para não violar o
 *     índice único nem escolher sozinha qual das duas é a boa.
 *
 * O valor anterior fica em additional_attributes.phone_ddi_repair, o que torna
 * o down() um rollback de verdade e deixa a mudança auditável.
 *
 * Número legítimo dos EUA (+1 seguido de 10 dígitos) tem a mesma forma de 11
 * dígitos e seria reescrito por engano. É um risco aceito: a operação é pt-BR,
 * o toE164 sempre assumiu BR, e nenhum caminho do produto grava número
 * americano com identifier 'phone:'. Em base internacional, rode antes o
 * SELECT equivalente ao CTE `candidate` e confira o que sairia.
 */
export class RepairBrPhoneDdi20260729120000 implements MigrationInterface {
  name = 'RepairBrPhoneDdi20260729120000';

  private readonly logger = new Logger(RepairBrPhoneDdi20260729120000.name);

  public async up(queryRunner: QueryRunner): Promise<void> {
    // UPDATE dentro de CTE com um SELECT final de propósito: o retorno de
    // queryRunner.query() para `UPDATE ... RETURNING` não é a lista de linhas
    // (vem `[linhas, afetadas]`), então contar pelo .length do resultado daria
    // sempre 2. Com o SELECT no fim, o retorno é uma linha de verdade.
    const rows = (await queryRunner.query(`
with candidate as (
  select c.id,
         c.account_id,
         c.phone_number as old_phone,
         '+55' || substring(c.phone_number from 2) as new_phone
    from public.contacts c
   where c.deleted_at is null
     and c.phone_number ~ '^\\+[0-9]{10,11}$'
     and c.identifier = 'phone:' || substring(c.phone_number from 2)
     -- DDD: dois dígitos, nenhum deles 0 (não existe DDD 0X nem X0)
     and substring(c.phone_number from 2 for 1) between '1' and '9'
     and substring(c.phone_number from 3 for 1) between '1' and '9'
     -- 11 dígitos = celular, e aí o nono dígito é obrigatoriamente 9.
     -- 10 dígitos = fixo, que não tem essa regra. O '+' conta no length:
     -- 10 dígitos => length 11, 11 dígitos => length 12.
     and (length(c.phone_number) = 11
          or substring(c.phone_number from 4 for 1) = '9')
),
free as (
  select cand.*
    from candidate cand
   where not exists (
     select 1
       from public.contacts other
      where other.account_id = cand.account_id
        and other.id <> cand.id
        and other.phone_number = cand.new_phone
   )
),
repaired as (
  update public.contacts c
     set phone_number = f.new_phone,
         identifier = 'phone:' || substring(f.new_phone from 2),
         additional_attributes = coalesce(c.additional_attributes, '{}'::jsonb)
           || jsonb_build_object('phone_ddi_repair',
                jsonb_build_object('from', f.old_phone, 'at', now())),
         updated_at = now()
    from free f
   where c.id = f.id
  returning c.id
)
select count(*)::text as repaired from repaired;
`)) as { repaired: string }[];
    this.logger.log(
      `${rows[0]?.repaired ?? '0'} contato(s) com telefone sem DDI corrigido(s) para +55`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
update public.contacts c
   set phone_number = c.additional_attributes -> 'phone_ddi_repair' ->> 'from',
       identifier = 'phone:' || substring(
         c.additional_attributes -> 'phone_ddi_repair' ->> 'from' from 2),
       additional_attributes = c.additional_attributes - 'phone_ddi_repair',
       updated_at = now()
 where c.additional_attributes ? 'phone_ddi_repair';
`);
  }
}

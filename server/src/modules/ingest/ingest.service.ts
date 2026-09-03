import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toE164 } from '../voice/voice-guard.service';
import { IngestAgentContactDto } from './dto/ingest-agent-contact.dto';
import { IngestListDto } from './dto/ingest-list.dto';

export interface IngestResult {
  listId: string;
  listKey: string;
  created: number;
  updated: number;
  skipped: number;
  removed: number;
  memberCount: number;
  invalidPhones: string[];
  /**
   * Lotes criados em campanhas vivas apontadas para esta lista. Vêm na
   * resposta para o n8n conseguir avisar o operador que há aprovação
   * esperando — sem isso o lote ficaria parado até alguém abrir a tela por
   * acaso.
   */
  pendingBatches: {
    campaignId: string;
    campaignName: string;
    batchId: string;
    contactCount: number;
  }[];
}

/**
 * Ingestão de lista operacional vinda de sistema externo (ERP → n8n).
 *
 * DataSource direto e não TenantTxHost: a rota é @Public() (autenticada por
 * chave de API, sem sessão), então o TenantContextInterceptor nem abre
 * transação e `auth.uid()` não existe — toda a escrita vai pela SECURITY
 * DEFINER `ingest_operational_list`, que recebe a conta já resolvida pelo
 * guard. Mesmo padrão do CallPersonalizationService.
 *
 * O que fica deste lado, e não no plpgsql, é a normalização de telefone:
 * toE164 é a única fonte da regra de DDI no produto, e duplicá-la em SQL
 * significaria manter duas versões dela.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly dataSource: DataSource) {}

  async ingestOperationalList(
    accountId: string,
    dto: IngestListDto,
  ): Promise<IngestResult> {
    const invalidPhones: string[] = [];
    const rows = dto.rows.map((r) => {
      const phone = toE164(r.phone);
      if (!phone && r.phone) invalidPhones.push(r.phone);
      return {
        externalId: r.externalId ?? null,
        name: r.name ?? null,
        phone,
        email: r.email ?? null,
        variables: r.variables ?? {},
      };
    });

    // Carga inteira inválida quase sempre é coluna errada no mapeamento do
    // n8n, não uma base ruim. Falhar alto aqui evita "sincronizou 0 contatos,
    // sem erro" — que o operador só descobriria quando a campanha não
    // discasse.
    if (rows.length > 0 && rows.every((r) => !r.phone)) {
      throw new BadRequestException(
        `Nenhuma das ${rows.length} linha(s) trouxe telefone válido. Confira o mapeamento da coluna de telefone no n8n — exemplos recebidos: ${invalidPhones.slice(0, 3).join(', ')}`,
      );
    }

    const result = await this.dataSource.query<{ ingested: IngestResult }[]>(
      `SELECT public.ingest_operational_list($1, $2::jsonb) AS ingested`,
      [
        accountId,
        JSON.stringify({
          listKey: dto.listKey,
          listName: dto.listName ?? null,
          campaignKind: dto.campaignKind ?? null,
          replaceMembers: dto.replaceMembers ?? false,
          rows,
        }),
      ],
    );

    const ingested = result[0]?.ingested;
    if (!ingested) {
      throw new BadRequestException('Falha ao gravar a lista operacional');
    }

    const pendingBatches = await this.enrollLiveCampaigns(
      ingested.listId,
      dto.listKey,
    );

    this.logger.log(
      `ingest account=${accountId} lista=${dto.listKey} criados=${ingested.created} atualizados=${ingested.updated} ignorados=${ingested.skipped} removidos=${ingested.removed} lotes=${pendingBatches.length}`,
    );

    return {
      ...ingested,
      invalidPhones: invalidPhones.slice(0, 20),
      pendingBatches,
    };
  }

  /**
   * Recebimento de um contato para automação de agente, com o telefone como
   * chave: insert-only — a mesma pessoa chegando de novo (por telefone,
   * identifier ou externalId) é ignorada, não atualizada. Evita que uma
   * carga reenviada sobrescreva correção manual feita no produto.
   *
   * Telefone inválido aqui é 400: quem manda um contato só está reagindo a um
   * evento (formulário enviado, pedido fechado) e precisa saber na hora que
   * aquele não entrou.
   */
  async ingestAgentContact(
    accountId: string,
    dto: IngestAgentContactDto,
  ): Promise<Record<string, unknown>> {
    const phone = toE164(dto.phone);
    if (!phone) {
      throw new BadRequestException(
        `Telefone inválido: "${dto.phone}". Envie com DDD (ex.: 11999998888) ou em E.164 (+5511999998888).`,
      );
    }
    const agentNames = await this.resolveAgents(accountId, [dto.agent]);

    const row = await this.insertAgentContact(
      accountId,
      dto,
      phone,
      agentNames.get(dto.agent),
    );
    const pendingBatches = row.skipped
      ? []
      : await this.enrollLiveCampaigns(
          String(row.listId),
          String(row.listKey),
        );

    this.logger.log(
      `ingest-agent account=${accountId} agente=${dto.agent} phone=${phone} criado=${String(row.created)} ignorado=${String(row.skipped)} lotes=${pendingBatches.length}`,
    );

    return { ...row, pendingBatches };
  }

  /**
   * Mesmo recebimento em lote (`[{…}, {…}]`).
   *
   * Duas diferenças que importam em relação a chamar o caminho de um contato N
   * vezes:
   *
   *  - Telefone inválido não derruba a carga inteira: a linha volta como
   *    `skipped` com motivo e as outras entram. Carga com 300 linhas não pode
   *    ser recusada por causa de dois números tortos. A exceção é a carga
   *    *inteira* inválida, que quase sempre é mapeamento de coluna errado no
   *    n8n — aí falha alto, como na ingestão de lista.
   *  - O convite às campanhas vivas roda uma vez por lista no fim, não por
   *    linha: por linha viraria um lote de aprovação por contato, e o operador
   *    veria 300 lotes de 1 na tela da campanha.
   *
   * Sem transação única de propósito: cada linha é uma chamada de insert,
   * então uma falha no meio deixa o que já entrou. Como a operação é
   * insert-only (contato existente é ignorado, não atualizado), reexecutar o
   * mesmo lote nunca duplica — só cria quem ainda não existia na primeira
   * passada.
   */
  async ingestAgentContacts(
    accountId: string,
    rows: IngestAgentContactDto[],
  ): Promise<Record<string, unknown>> {
    const normalized = rows.map((dto) => ({ dto, phone: toE164(dto.phone) }));
    const invalidPhones = normalized
      .filter((r) => !r.phone)
      .map((r) => r.dto.phone);

    if (rows.length > 0 && invalidPhones.length === rows.length) {
      throw new BadRequestException(
        `Nenhuma das ${rows.length} linha(s) trouxe telefone válido. Confira o mapeamento da coluna de telefone — exemplos recebidos: ${invalidPhones.slice(0, 3).join(', ')}`,
      );
    }

    // Antes do loop, e não linha a linha: agente inexistente é erro de
    // configuração da integração, não dado ruim de uma linha — recusar a carga
    // inteira evita gravar metade dela em uma lista que ninguém trabalha.
    const agentNames = await this.resolveAgents(
      accountId,
      rows.map((r) => r.agent),
    );

    const results: Record<string, unknown>[] = [];
    // Map em vez de Set: o convite precisa da lista *e* da chave dela, e a
    // chave é o que aparece no aviso para o operador.
    const lists = new Map<string, string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const { dto, phone } of normalized) {
      if (!phone) {
        skipped += 1;
        results.push({
          phone: dto.phone,
          skipped: true,
          reason: 'telefone inválido',
        });
        continue;
      }

      const row = await this.insertAgentContact(
        accountId,
        dto,
        phone,
        agentNames.get(dto.agent),
      );
      results.push(row);

      if (row.skipped) {
        skipped += 1;
      } else {
        if (row.created) created += 1;
        else updated += 1;
        lists.set(String(row.listId), String(row.listKey));
      }
    }

    const pendingBatches: IngestResult['pendingBatches'] = [];
    for (const [listId, listKey] of lists) {
      pendingBatches.push(...(await this.enrollLiveCampaigns(listId, listKey)));
    }

    this.logger.log(
      `ingest-agent-lote account=${accountId} linhas=${rows.length} criados=${created} atualizados=${updated} ignorados=${skipped} lotes=${pendingBatches.length}`,
    );

    return {
      processed: rows.length,
      created,
      updated,
      skipped,
      results,
      pendingBatches,
    };
  }

  /**
   * O `agent` do payload é o id de uma persona desta conta — é o que o template
   * da tela já traz preenchido. Sem esta checagem, um id errado (ou o slug de
   * um agente de chat) criaria a lista `agent:<id inexistente>` e a carga
   * ficaria parada num canto que nenhuma campanha aponta, sem erro nenhum.
   *
   * Leitura direta pelo DataSource: `agent_personas` tem RLS sem FORCE, então o
   * dono da tabela (o role da aplicação) lê sem contexto de tenant — mesma
   * situação da consulta a voice_campaigns no convite de campanha.
   */
  private async resolveAgents(
    accountId: string,
    agents: string[],
  ): Promise<Map<string, string>> {
    const distinct = [...new Set(agents)];
    const byId = new Map<string, string>();
    if (distinct.length === 0) return byId;

    const found = await this.dataSource.query<{ id: string; name: string }[]>(
      `SELECT id, name FROM public.agent_personas
        WHERE account_id = $1 AND id = ANY($2::uuid[])`,
      [accountId, distinct],
    );
    for (const row of found) byId.set(row.id, row.name);

    const missing = distinct.filter((a) => !byId.has(a));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Agente não encontrado nesta conta: ${missing.join(', ')}. Use o id que o template traz em Configurações > Webhooks > Recebimento.`,
      );
    }
    return byId;
  }

  /**
   * O insert em si — insert-only, contato existente é ignorado. `phone` já
   * normalizado em E.164 — a função no banco recusa qualquer outro formato,
   * e a regra de DDI mora só no toE164.
   *
   * O contato entra na lista do agente (`agent:<agent>`), e é essa lista que a
   * campanha de voz aponta — nada aqui disca. Campanha com auto_enroll_mode
   * 'approval' ganha um lote pendente, liberado por uma pessoa na tela.
   */
  private async insertAgentContact(
    accountId: string,
    dto: IngestAgentContactDto,
    phone: string,
    agentName?: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.dataSource.query<
      { ingested: Record<string, unknown> }[]
    >(`SELECT public.ingest_agent_contact($1, $2::jsonb) AS ingested`, [
      accountId,
      JSON.stringify({
        agent: dto.agent,
        phone,
        name: dto.name ?? null,
        email: dto.email ?? null,
        externalId: dto.externalId ?? null,
        variables: dto.variables ?? {},
        campaignKind: dto.campaignKind ?? null,
        listKey: dto.listKey ?? null,
        // `listName` só quando o integrador pediu explicitamente — é o único
        // caso em que renomear uma lista que já existe é o comportamento certo.
        listName: dto.listName ?? null,
        // Nome usado apenas na criação: a chave é `agent:<uuid>` (estável), mas
        // o operador vê "Agente Carla" na tela de listas, não um uuid.
        defaultListName: agentName ? `Agente ${agentName}` : null,
      }),
    ]);

    const ingested = result[0]?.ingested;
    if (!ingested) {
      throw new BadRequestException('Falha ao gravar o contato');
    }
    return ingested;
  }

  /**
   * Oferece os membros novos às campanhas vivas apontadas para esta lista.
   *
   * Nada aqui disca: os contatos entram como 'pending_approval', que o
   * dispatcher não enxerga. A carga do ERP prepara o lote; quem libera é uma
   * pessoa na tela da campanha. É essa separação que evita uma consulta mal
   * ajustada no n8n às 6h virar ligação para o cliente errado às 6h01.
   *
   * Falha de uma campanha não derruba a ingestão: a lista já foi gravada, que
   * é o dado principal, e um lote não criado aparece na próxima carga.
   */
  private async enrollLiveCampaigns(
    listId: string,
    listKey: string,
  ): Promise<IngestResult['pendingBatches']> {
    const campaigns = await this.dataSource.query<
      { id: string; name: string }[]
    >(
      `SELECT id, name FROM public.voice_campaigns
        WHERE source_list_id = $1
          AND auto_enroll_mode = 'approval'
          AND status NOT IN ('canceled','cancelled','failed')`,
      [listId],
    );

    const batches: IngestResult['pendingBatches'] = [];
    for (const campaign of campaigns) {
      try {
        const rows = await this.dataSource.query<
          { result: { enrolled: number; batchId?: string } }[]
        >(`SELECT public.campaign_enroll_new_members($1, $2) AS result`, [
          campaign.id,
          `ingest:${listKey}`,
        ]);
        const enrolled = rows[0]?.result;
        if (enrolled?.batchId && enrolled.enrolled > 0) {
          batches.push({
            campaignId: campaign.id,
            campaignName: campaign.name,
            batchId: enrolled.batchId,
            contactCount: enrolled.enrolled,
          });
        }
      } catch (err) {
        this.logger.error(
          `falha ao criar lote na campanha ${campaign.id}: ${(err as Error).message}`,
        );
      }
    }
    return batches;
  }

  /**
   * Desfechos de uma lista, para o n8n devolver ao ERP sem precisar saber o id
   * da campanha. Cobre o caminho de volta enquanto o webhook de saída não
   * existe: o n8n agenda um pull e casa pelo externalId, que é a chave que o
   * ERP entende.
   */
  async listOutcomes(
    accountId: string,
    listKey: string,
    since?: string,
  ): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT c.external_id      AS "externalId",
              c.phone_number     AS "phone",
              vcc.status         AS "status",
              vcc.outcome        AS "disposition",
              vcc.attempts       AS "attempts",
              vcc.finished_at    AS "finishedAt",
              vc.outcome_category AS "outcomeCategory",
              vc.outcome_summary  AS "outcomeSummary",
              vc.duration_seconds AS "durationSec",
              camp.id            AS "campaignId",
              camp.name          AS "campaignName"
         FROM public.contact_lists cl
         JOIN public.contact_list_members clm ON clm.list_id = cl.id
         JOIN public.contacts c ON c.id = clm.contact_id
         JOIN public.voice_campaign_contacts vcc ON vcc.contact_id = c.id
         JOIN public.voice_campaigns camp ON camp.id = vcc.campaign_id
         LEFT JOIN public.voice_calls vc ON vc.id = vcc.voice_call_id
        WHERE cl.account_id = $1
          AND cl.external_key = $2
          AND ($3::timestamptz IS NULL OR vcc.updated_at >= $3::timestamptz)
        ORDER BY vcc.updated_at DESC
        LIMIT 5000`,
      [accountId, listKey, since ?? null],
    );
  }
}

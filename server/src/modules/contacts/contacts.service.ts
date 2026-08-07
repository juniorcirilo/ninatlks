import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { toE164 } from '../voice/voice-guard.service';
import { Contacts } from '../../database/entities/contacts/contacts.entity';
import { ContactLists } from '../../database/entities/contacts/contact_lists.entity';
import { ContactTags } from '../../database/entities/contacts/contact_tags.entity';

export interface CentralContactRow {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
  score: number;
  lifecycle_stage: string;
  operational_status: string;
  last_sentiment: string | null;
  last_activity_at: Date | null;
  last_call_at: Date | null;
  last_whatsapp_at: Date | null;
  owner_user_id: string | null;
  briefing: Record<string, unknown> | null;
}

export interface ProductivityRow {
  user_id: string;
  name: string;
  contacts: number;
  hot: number;
  customers: number;
  delinquent: number;
  last7d_calls: number;
  last7d_whatsapp: number;
}

export interface CallTimelineRow {
  id: string;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  duration_seconds: number | null;
  summary: string | null;
  sentiment: string | null;
  classification: string | null;
}

export interface ConversationTimelineRow {
  id: string;
  display_id: number;
  status: string;
  last_activity_at: Date | null;
  cached_label_list: string[] | null;
}

export interface ListTimelineRow {
  list_id: string;
  added_at: Date;
  name: string;
  campaign_kind: string | null;
}

export interface EditableCampaignRow {
  id: string;
  name: string;
  status: string;
  campaign_kind: string | null;
}

const CENTRAL_COLUMNS = [
  'id',
  'name',
  'email',
  'phone_number',
  'identifier',
  'score',
  'lifecycle_stage',
  'operational_status',
  'last_sentiment',
  'last_activity_at',
  'last_call_at',
  'last_whatsapp_at',
  'owner_user_id',
  'briefing',
];

@Injectable({ scope: Scope.REQUEST })
export class ContactsService {
  constructor(private readonly tx: TenantTxHost) {}

  async listCentral(accountId: string): Promise<CentralContactRow[]> {
    return this.tx.manager.query<CentralContactRow[]>(
      `SELECT ${CENTRAL_COLUMNS.join(', ')} FROM public.contacts
       WHERE account_id = $1 AND blocked = false
       ORDER BY last_activity_at DESC NULLS LAST
       LIMIT 1000`,
      [accountId],
    );
  }

  /**
   * Candidatos para "criar lista sem CSV": contato com telefone, não
   * bloqueado, não removido, opcionalmente restrito a um estágio do funil.
   *
   * `excludeListed` é a régua que faltava — sem ela, uma lista nova sem
   * filtro nenhum varria a conta inteira, inclusive contato que já é membro
   * exclusivo de outra lista operacional (ex.: alimentada por webhook de
   * agente). `already_listed` sai de um EXISTS contra
   * `contact_list_members`, sem se importar com *qual* lista — o critério é
   * "já está em alguma", não uma lista específica.
   *
   * Devolve as duas contagens (`totalEligible`, `alreadyInOtherList`) mesmo
   * quando `excludeListed` é true: é o que permite a tela dizer "39 destes já
   * estão em outra lista" independente da escolha do operador.
   */
  async listCreationCandidates(
    accountId: string,
    opts: { stageId?: string; excludeListed: boolean; limit: number },
  ): Promise<{
    contacts: Array<{ id: string; name: string | null; phone_number: string | null; email: string | null }>;
    totalEligible: number;
    alreadyInOtherList: number;
  }> {
    const rows = await this.tx.manager.query<
      Array<{
        id: string;
        name: string | null;
        phone_number: string | null;
        email: string | null;
        already_listed: boolean;
      }>
    >(
      `SELECT c.id, c.name, c.phone_number, c.email,
              EXISTS (
                SELECT 1 FROM public.contact_list_members m WHERE m.contact_id = c.id
              ) AS already_listed
         FROM public.contacts c
        WHERE c.account_id = $1
          AND c.blocked = false
          AND c.deleted_at IS NULL
          AND c.phone_number IS NOT NULL
          AND ($2::uuid IS NULL OR c.stage_id = $2::uuid)
        ORDER BY c.last_activity_at DESC NULLS LAST
        LIMIT $3`,
      [accountId, opts.stageId ?? null, opts.limit],
    );

    const totalEligible = rows.length;
    const alreadyInOtherList = rows.filter((r) => r.already_listed).length;
    const contacts = (opts.excludeListed ? rows.filter((r) => !r.already_listed) : rows).map(
      ({ already_listed: _already_listed, ...c }) => c,
    );

    return { contacts, totalEligible, alreadyInOtherList };
  }

  async create(
    accountId: string,
    input: {
      name?: string;
      email?: string;
      phoneNumber?: string;
      location?: string;
    },
  ) {
    // Mesma normalização do import (toE164, região BR) — sem ela, contato
    // criado na tela e contato importado do CSV geravam identifier diferente
    // pro mesmo telefone e não deduplicavam entre si.
    const phoneNumber = toE164(input.phoneNumber);
    const identifier = input.email
      ? `email:${input.email}`
      : phoneNumber
        ? `phone:${phoneNumber.slice(1)}`
        : `anon:${randomUUID()}`;
    const contact = this.tx.manager.create(Contacts, {
      accountId,
      name: input.name ?? null,
      email: input.email ?? null,
      phoneNumber,
      location: input.location ?? null,
      identifier,
    });
    return this.tx.manager.save(Contacts, contact);
  }

  async updateOps(
    accountId: string,
    id: string,
    patch: Partial<
      Pick<Contacts, 'lifecycleStage' | 'operationalStatus' | 'ownerUserId'>
    >,
  ) {
    // Every field on UpdateContactOpsDto is optional, and the global
    // ValidationPipe runs with whitelist:true — so a body carrying only
    // unknown keys (or no body at all) arrives here with nothing usable, and
    // TypeORM's .set() throws UpdateValuesMissingError, surfacing as a 500 on
    // what is really a malformed request. Note the filter on `undefined`:
    // class-transformer materializes every declared optional property as an
    // own key holding undefined, so an Object.keys() length check sees 3
    // fields where the caller sent none — TypeORM drops them later and
    // throws anyway.
    const setFields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(setFields).length === 0) {
      throw new BadRequestException(
        'Nenhum campo atualizável informado. Campos aceitos: lifecycleStage, operationalStatus, ownerUserId.',
      );
    }
    await this.tx.manager
      .createQueryBuilder()
      .update(Contacts)
      .set(setFields)
      .where('id = :id AND account_id = :accountId', { id, accountId })
      .execute();
  }

  async importCsv(
    accountId: string,
    rows: {
      name?: string | null;
      phoneNumber?: string | null;
      email?: string | null;
    }[],
  ) {
    const payload = rows
      .map((r) => {
        // toE164 e não `+${só dígitos}`: base de ERP/CSV vem sem DDI, e
        // prefixar '+' cru em "11987654321" produzia +11987654321 — número dos
        // EUA. toE164 assume BR para 10/11 dígitos e valida o resultado, então
        // linha impossível de discar entra como telefone nulo em vez de virar
        // uma ligação errada.
        const phoneNumber = toE164(r.phoneNumber);
        const email = r.email || null;
        const identifier = email
          ? `email:${email}`
          : phoneNumber
            ? `phone:${phoneNumber.slice(1)}`
            : null;
        return {
          name: r.name || null,
          phoneNumber,
          email,
          identifier,
        };
      })
      .filter((c) => c.identifier);
    if (!payload.length)
      return { created: 0, updated: 0, skipped: rows.length };

    let created = 0;
    let updated = 0;
    for (const row of payload) {
      // `xmax = 0` separa inserção de atualização no upsert: sem isso o
      // contador somava as duas coisas e a tela anunciava "N contatos
      // importados" para uma carga que só reencontrou gente que já existia.
      const result = await this.tx.manager.query<{ inserted: boolean }[]>(
        `INSERT INTO public.contacts (account_id, name, phone_number, email, identifier)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, identifier) WHERE identifier IS NOT NULL DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
         RETURNING (xmax = 0) AS inserted`,
        [accountId, row.name, row.phoneNumber, row.email, row.identifier],
      );
      if (result[0]?.inserted) created++;
      else if (result.length) updated++;
    }
    return { created, updated, skipped: rows.length - payload.length };
  }

  async bulkAssignOwner(
    accountId: string,
    contactIds: string[],
    ownerUserId: string | null,
  ) {
    if (!contactIds.length) return;
    await this.tx.manager
      .createQueryBuilder()
      .update(Contacts)
      .set({ ownerUserId })
      .where('account_id = :accountId AND id IN (:...contactIds)', {
        accountId,
        contactIds,
      })
      .execute();
  }

  async bulkSetLifecycle(
    accountId: string,
    contactIds: string[],
    stage: string,
  ) {
    if (!contactIds.length) return;
    await this.tx.manager
      .createQueryBuilder()
      .update(Contacts)
      .set({ lifecycleStage: stage })
      .where('account_id = :accountId AND id IN (:...contactIds)', {
        accountId,
        contactIds,
      })
      .execute();
  }

  async bulkSetOperationalStatus(
    accountId: string,
    contactIds: string[],
    status: string,
  ) {
    if (!contactIds.length) return;
    await this.tx.manager
      .createQueryBuilder()
      .update(Contacts)
      .set({ operationalStatus: status })
      .where('account_id = :accountId AND id IN (:...contactIds)', {
        accountId,
        contactIds,
      })
      .execute();
  }

  async bulkAssignRoundRobin(
    accountId: string,
    contactIds: string[],
    ownerIds: string[],
  ) {
    if (!contactIds.length || !ownerIds.length) return { assigned: 0 };
    const groups = new Map<string, string[]>();
    contactIds.forEach((cid, i) => {
      const owner = ownerIds[i % ownerIds.length];
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner)!.push(cid);
    });
    for (const [owner, ids] of groups) {
      await this.tx.manager
        .createQueryBuilder()
        .update(Contacts)
        .set({ ownerUserId: owner })
        .where('account_id = :accountId AND id IN (:...ids)', {
          accountId,
          ids,
        })
        .execute();
    }
    return { assigned: contactIds.length };
  }

  async fetchTagSuggestions(accountId: string) {
    const rows = await this.tx.manager.find(ContactTags, {
      where: { accountId },
      select: { tag: true },
      take: 500,
    });
    return Array.from(new Set(rows.map((r) => r.tag))).sort();
  }

  async bulkAddTag(accountId: string, contactIds: string[], tag: string) {
    const trimmed = tag.trim();
    if (!contactIds.length || !trimmed) return;
    for (const contactId of contactIds) {
      await this.tx.manager.query(
        `INSERT INTO public.contact_tags (account_id, contact_id, tag)
         VALUES ($1, $2, $3)
         ON CONFLICT (contact_id, tag) DO NOTHING`,
        [accountId, contactId, trimmed],
      );
    }
  }

  async fetchProductivity(accountId: string): Promise<ProductivityRow[]> {
    return this.tx.manager.query<ProductivityRow[]>(
      `SELECT
         coalesce(au.user_id::text, '__unassigned') AS user_id,
         coalesce(p.display_name, p.name, p.email, 'Sem responsável') AS name,
         count(c.id)::int AS contacts,
         count(*) FILTER (WHERE coalesce(c.score, 0) >= 75)::int AS hot,
         count(*) FILTER (WHERE c.lifecycle_stage = 'customer')::int AS customers,
         count(*) FILTER (WHERE c.lifecycle_stage = 'delinquent')::int AS delinquent,
         count(*) FILTER (WHERE c.last_call_at >= now() - interval '7 days')::int AS last7d_calls,
         count(*) FILTER (WHERE c.last_whatsapp_at >= now() - interval '7 days')::int AS last7d_whatsapp
       FROM public.contacts c
       LEFT JOIN public.account_users au ON au.user_id = c.owner_user_id AND au.account_id = c.account_id
       LEFT JOIN public.profiles p ON p.id = au.user_id
       WHERE c.account_id = $1 AND c.blocked = false
       GROUP BY au.user_id, p.display_name, p.name, p.email
       ORDER BY count(c.id) DESC`,
      [accountId],
    );
  }

  /**
   * As variáveis que a ingestão por agente (webhook/n8n) ou por lote do ERP
   * gravou para este contato — mesmo lugar de onde `campaigns.service.ts` lê
   * na hora de montar `voice_campaign_contacts.variables`. Existe pra "Puxar
   * existente" no wizard de lista mostrar o que já se sabe desse contato
   * antes de adicioná-lo, sem esperar a campanha pra descobrir.
   */
  async getVariables(accountId: string, contactId: string) {
    const rows = await this.tx.manager.query<
      {
        name: string | null;
        phone_number: string | null;
        email: string | null;
        external_id: string | null;
        variables: Record<string, unknown> | null;
      }[]
    >(
      `SELECT name, phone_number, email, external_id,
              custom_attributes -> 'ingest_variables' AS variables
         FROM public.contacts
        WHERE id = $1 AND account_id = $2`,
      [contactId, accountId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Contato não encontrado');
    return {
      name: row.name,
      phone: row.phone_number,
      email: row.email,
      externalId: row.external_id,
      variables: row.variables ?? {},
    };
  }

  /**
   * Escrita manual das variáveis de fala, pro caso em que não veio nenhuma
   * carga automática (n8n/ERP) pra esse contato ainda — mesmo merge que
   * `ingest_agent_contact` faz, só que disparado pela tela em vez do webhook.
   * Substitui só as chaves enviadas; o que já existia e não foi mencionado
   * permanece.
   */
  async setVariables(
    accountId: string,
    contactId: string,
    variables: Record<string, string>,
  ) {
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `UPDATE public.contacts
          SET custom_attributes = coalesce(custom_attributes, '{}'::jsonb)
                || jsonb_build_object(
                     'ingest_variables',
                     coalesce(custom_attributes -> 'ingest_variables', '{}'::jsonb) || $3::jsonb
                   ),
              updated_at = now()
        WHERE id = $1 AND account_id = $2
        RETURNING id`,
      [contactId, accountId, JSON.stringify(variables)],
    );
    if (!rows.length) throw new NotFoundException('Contato não encontrado');
    return this.getVariables(accountId, contactId);
  }

  async fetchTimeline(accountId: string, contactId: string) {
    const [calls, conversations, lists] = await Promise.all([
      this.tx.manager.query<CallTimelineRow[]>(
        `SELECT vc.id, vc.status, vc.started_at, vc.ended_at, vc.duration_seconds,
                vc.ai_summary AS summary, vc.sentiment, vc.classification
         FROM public.voice_calls vc
         JOIN public.conversations c ON c.id = vc.conversation_id
         WHERE vc.account_id = $1 AND c.contact_id = $2
         ORDER BY vc.started_at DESC LIMIT 20`,
        [accountId, contactId],
      ),
      this.tx.manager.query<ConversationTimelineRow[]>(
        `SELECT id, display_id, status, last_activity_at, cached_label_list
         FROM public.conversations
         WHERE account_id = $1 AND contact_id = $2
         ORDER BY last_activity_at DESC LIMIT 20`,
        [accountId, contactId],
      ),
      this.tx.manager.query<ListTimelineRow[]>(
        `SELECT clm.list_id, clm.added_at, cl.name, cl.campaign_kind
         FROM public.contact_list_members clm
         JOIN public.contact_lists cl ON cl.id = clm.list_id
         WHERE clm.contact_id = $1
         LIMIT 20`,
        [contactId],
      ),
    ]);
    return { calls, conversations, lists };
  }

  // ── Lists ──────────────────────────────────────────────────────
  async listContactLists(accountId: string) {
    return this.tx.manager.find(ContactLists, {
      where: { accountId },
      select: { id: true, name: true, memberCount: true, description: true, campaignKind: true, personaId: true, filters: true, externalKey: true, createdAt: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getContactList(accountId: string, listId: string) {
    const list = await this.tx.manager.findOneOrFail(ContactLists, {
      where: { id: listId, accountId },
      select: { id: true, name: true, memberCount: true, description: true, campaignKind: true, personaId: true, filters: true, externalKey: true, createdAt: true },
    });
    return list;
  }

  async updateContactList(accountId: string, listId: string, body: { name?: string; description?: string | null; campaignKind?: string; personaId?: string | null; filters?: Record<string, unknown>; externalKey?: string | null }) {
    const list = await this.tx.manager.findOneOrFail(ContactLists, {
      where: { id: listId, accountId },
    });
    if (body.name !== undefined) list.name = body.name;
    if (body.description !== undefined) list.description = body.description;
    if (body.campaignKind !== undefined) list.campaignKind = body.campaignKind;
    if (body.personaId !== undefined) list.personaId = body.personaId;
    if (body.filters !== undefined) list.filters = body.filters;
    if (body.externalKey !== undefined) {
      // Vazio vira NULL, não string vazia: o índice único é parcial
      // (`where external_key is not null`), então duas listas com '' colidiriam
      // de verdade em vez de simplesmente não ter chave.
      list.externalKey = body.externalKey?.trim() ? body.externalKey.trim() : null;
    }
    await this.saveListHandlingKeyConflict(list);
    return { ok: true };
  }

  /**
   * `contact_lists_account_external_key_uniq` chega como 23505 e viraria 500. É
   * erro de operador com correção óbvia — a chave já está em uso por outra
   * lista —, então vira 409 dizendo isso.
   */
  private async saveListHandlingKeyConflict(list: ContactLists) {
    try {
      await this.tx.manager.save(ContactLists, list);
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') {
        throw new ConflictException(
          `A chave de recebimento "${list.externalKey}" já está em uso por outra lista desta conta.`,
        );
      }
      throw e;
    }
  }

  async deleteContactList(accountId: string, listId: string) {
    const list = await this.tx.manager.findOneOrFail(ContactLists, {
      where: { id: listId, accountId },
    });
    await this.tx.manager.delete(ContactLists, listId);
    return { ok: true };
  }

  async listContactListMembers(accountId: string, listId: string) {
    const rows = await this.tx.manager.query<{ contact_id: string; name: string | null; phone_number: string | null; email: string | null }[]>(
      `SELECT c.id as contact_id, c.name, c.phone_number, c.email
       FROM public.contact_list_members clm
       JOIN public.contacts c ON c.id = clm.contact_id
       WHERE clm.list_id = $1 AND clm.account_id = $2
       ORDER BY clm.added_at DESC`,
      [listId, accountId],
    );
    return rows;
  }

  /**
   * Cria a lista com a configuração completa. `contactIds` é opcional: lista
   * operacional alimentada por recebimento nasce vazia e ganha membros quando a
   * primeira carga chega.
   */
  async createListFromContacts(
    accountId: string,
    input: {
      name: string;
      contactIds?: string[];
      description?: string;
      campaignKind?: string;
      personaId?: string;
      externalKey?: string;
    },
  ) {
    const contactIds = input.contactIds ?? [];
    const list = this.tx.manager.create(ContactLists, {
      accountId,
      name: input.name,
      description: input.description ?? null,
      campaignKind: input.campaignKind ?? null,
      personaId: input.personaId ?? null,
      externalKey: input.externalKey?.trim() ? input.externalKey.trim() : null,
      filters: {},
      memberCount: contactIds.length,
    });
    await this.saveListHandlingKeyConflict(list);
    await this.addContactsToList(accountId, list.id, contactIds);
    return list.id;
  }

  async addContactsToList(
    accountId: string,
    listId: string,
    contactIds: string[],
  ) {
    if (!contactIds.length) return { inserted: 0 };
    for (const contactId of contactIds) {
      await this.tx.manager.query(
        `INSERT INTO public.contact_list_members (list_id, contact_id, account_id, added_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (list_id, contact_id) DO NOTHING`,
        [listId, contactId, accountId],
      );
    }
    await this.tx.manager.query(
      `UPDATE public.contact_lists SET member_count = (
         SELECT count(*) FROM public.contact_list_members WHERE list_id = $1
       ) WHERE id = $1`,
      [listId],
    );
    return { inserted: contactIds.length };
  }

  // Lite list for the "add to campaign" bulk action — not the full
  // campaigns domain (that's its own module, ported separately).
  async listEditableCampaigns(
    accountId: string,
  ): Promise<EditableCampaignRow[]> {
    return this.tx.manager.query<EditableCampaignRow[]>(
      `SELECT id, name, status, campaign_kind FROM public.voice_campaigns
       WHERE account_id = $1 AND status IN ('draft', 'scheduled', 'paused')
       ORDER BY created_at DESC`,
      [accountId],
    );
  }

  async bulkAddToCampaign(
    accountId: string,
    campaignId: string,
    contacts: { id: string; phoneNumber: string | null }[],
  ) {
    const valid = contacts.filter(
      (c) => c.phoneNumber && c.phoneNumber.replace(/\D/g, '').length >= 8,
    );
    if (!valid.length) return { added: 0, skipped: contacts.length };
    let added = 0;
    for (const c of valid) {
      // Mesmas variáveis de operação que o caminho de criar campanha a partir
      // de lista carrega (campaigns.service.ts): sem elas, contato adicionado
      // por este atalho entrava na campanha sem o dado do ERP e a agente
      // ligava às cegas.
      const result = await this.tx.manager.query<{ id: string }[]>(
        `INSERT INTO public.voice_campaign_contacts
           (account_id, campaign_id, contact_id, to_number, phone_number, status, variables)
         SELECT $1, $2, $3, $4, $4, 'queued',
                coalesce(ct.custom_attributes -> 'ingest_variables', '{}'::jsonb)
           FROM public.contacts ct
          WHERE ct.id = $3 AND ct.account_id = $1
         RETURNING id`,
        [accountId, campaignId, c.id, c.phoneNumber],
      );
      if (result.length) added++;
    }
    await this.tx.manager.query(
      `UPDATE public.voice_campaigns SET total_contacts = (
         SELECT count(*) FROM public.voice_campaign_contacts WHERE campaign_id = $1
       ) WHERE id = $1`,
      [campaignId],
    );
    return { added, skipped: contacts.length - added };
  }
}

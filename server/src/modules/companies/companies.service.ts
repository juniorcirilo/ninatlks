import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { toE164 } from '../voice/voice-guard.service';

export interface CompanyRow {
  id: string;
  account_id: string;
  name: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  vendedor_id: string | null;
  vendedor_nome_erp: string | null;
  external_id: string | null;
}

export interface CompanyListRow extends CompanyRow {
  vendedor_resolved_nome: string | null;
  created_at: string;
  linked_contacts_count: number;
}

export interface ClientCompanyRow {
  contact_id: string;
  contact_name: string | null;
  phone_number: string | null;
  company_id: string | null;
  company_name: string | null;
  company_external_id: string | null;
  company_razao_social: string | null;
}

export interface LinkClientCompanyResult {
  created: number;
  linked: number;
  errors: { row: number; phone: string; reason: string }[];
}

/**
 * `companies` não tem entidade TypeORM com as colunas novas
 * (razao_social/nome_fantasia/vendedor_id/vendedor_nome_erp/external_id —
 * ver migration 20260903030000-CompanyIdentity.ts), só a entidade legada em
 * database/entities/accounts/companies.entity.ts. Em vez de estender aquela
 * entidade (usada em outros lugares e fora do escopo desta mudança), lê e
 * escreve por SQL cru, igual a getVariables/setVariables em
 * ContactsService.
 */
@Injectable({ scope: Scope.REQUEST })
export class CompaniesService {
  constructor(private readonly tx: TenantTxHost) {}

  async list(accountId: string, search?: string): Promise<CompanyListRow[]> {
    const params: unknown[] = [accountId];
    let where = 'co.account_id = $1';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND (co.name ILIKE $${params.length} OR co.razao_social ILIKE $${params.length} OR co.nome_fantasia ILIKE $${params.length} OR co.external_id ILIKE $${params.length})`;
    }
    return this.tx.manager.query<CompanyListRow[]>(
      `SELECT co.id, co.account_id, co.name, co.razao_social, co.nome_fantasia,
              co.vendedor_id, co.vendedor_nome_erp, co.external_id, co.created_at,
              coalesce(p.display_name, p.name, p.email) AS vendedor_resolved_nome,
              coalesce(cc.n, 0)::int AS linked_contacts_count
         FROM public.companies co
         LEFT JOIN public.account_users au ON au.user_id = co.vendedor_id AND au.account_id = co.account_id
         LEFT JOIN public.profiles p ON p.id = au.user_id
         LEFT JOIN LATERAL (
           SELECT count(*) AS n FROM public.contacts c
            WHERE c.company_id = co.id AND c.deleted_at IS NULL
         ) cc ON true
        WHERE ${where}
        ORDER BY co.name ASC
        LIMIT 500`,
      params,
    );
  }

  /** Clientes vinculados a uma empresa — usado pelo painel de edição pra
   * mostrar quem já está ligado antes de trocar/adicionar mais um. */
  async listCompanyContacts(
    accountId: string,
    companyId: string,
  ): Promise<{ id: string; name: string | null; phone_number: string | null }[]> {
    return this.tx.manager.query(
      `SELECT id, name, phone_number FROM public.contacts
        WHERE account_id = $1 AND company_id = $2 AND deleted_at IS NULL
        ORDER BY name ASC NULLS LAST
        LIMIT 200`,
      [accountId, companyId],
    );
  }

  async create(
    accountId: string,
    input: {
      externalId?: string | null;
      name?: string | null;
      razaoSocial?: string | null;
      nomeFantasia?: string | null;
      vendedorId?: string | null;
    },
  ): Promise<CompanyRow> {
    if (input.vendedorId != null) {
      await this.assertVendedorMembership(accountId, input.vendedorId);
    }
    const externalId = input.externalId?.trim() || null;
    const name =
      input.name?.trim() ||
      input.razaoSocial?.trim() ||
      input.nomeFantasia?.trim() ||
      (externalId ? `Empresa ${externalId}` : null);
    if (!name) {
      throw new BadRequestException(
        'Informe ao menos um nome, razão social, nome fantasia ou código (empresa_id).',
      );
    }

    try {
      const rows = await this.tx.manager.query<{ id: string }[]>(
        `INSERT INTO public.companies (account_id, name, razao_social, nome_fantasia, vendedor_id, external_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          accountId,
          name,
          input.razaoSocial ?? null,
          input.nomeFantasia ?? null,
          input.vendedorId ?? null,
          externalId,
        ],
      );
      return this.get(accountId, rows[0].id);
    } catch (err) {
      if (err instanceof Error && /companies_account_external_id_uniq/.test(err.message)) {
        throw new ConflictException(
          `Já existe uma empresa com o código ${externalId} nesta conta.`,
        );
      }
      throw err;
    }
  }

  /**
   * Clientes (contatos) com a empresa que já têm vinculada, se houver — é a
   * lista base da tela Empresas: aqui empresa é sempre cadastrada A PARTIR
   * de um cliente existente, nunca solta.
   */
  async listClients(accountId: string, search?: string): Promise<ClientCompanyRow[]> {
    const params: unknown[] = [accountId];
    let where = 'c.account_id = $1 AND c.deleted_at IS NULL';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND (c.name ILIKE $${params.length} OR c.phone_number ILIKE $${params.length} OR co.name ILIKE $${params.length} OR co.external_id ILIKE $${params.length})`;
    }
    return this.tx.manager.query<ClientCompanyRow[]>(
      `SELECT c.id AS contact_id, c.name AS contact_name, c.phone_number,
              co.id AS company_id, co.name AS company_name, co.external_id AS company_external_id,
              co.razao_social AS company_razao_social
         FROM public.contacts c
         LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE ${where}
        ORDER BY (co.id IS NULL) ASC, c.name ASC NULLS LAST
        LIMIT 500`,
      params,
    );
  }

  /**
   * Vincula um cliente (contato) já existente a uma empresa — achada por
   * `companyId` (empresa já escolhida na tela), por `externalId` (empresa_id
   * — acha ou cria), ou, sem nenhum dos dois, cria uma empresa avulsa com
   * `name` só pra este cliente (sem empresa_id, vínculo com ERP fica pra
   * quando o dado chegar).
   */
  async linkClient(
    accountId: string,
    input: {
      contactId: string;
      companyId?: string | null;
      externalId?: string | null;
      name?: string | null;
    },
  ): Promise<CompanyRow> {
    const { id: companyId } = await this.resolveOrCreateCompany(accountId, input);
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `UPDATE public.contacts SET company_id = $1, updated_at = now()
        WHERE id = $2 AND account_id = $3
        RETURNING id`,
      [companyId, input.contactId, accountId],
    );
    if (!rows.length) throw new NotFoundException('Cliente não encontrado');
    return this.get(accountId, companyId);
  }

  /**
   * Import em massa — cada linha identifica o cliente por telefone (chave
   * já usada em todo o resto do produto) e a empresa por empresa_id
   * (acha/cria). Sem empresa_id, cria uma empresa avulsa com `name`.
   */
  async bulkLinkClients(
    accountId: string,
    rows: { phone: string; externalId?: string | null; name?: string | null }[],
  ): Promise<LinkClientCompanyResult> {
    const result: LinkClientCompanyResult = { created: 0, linked: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const phone = toE164(row.phone);
      if (!phone) {
        result.errors.push({ row: i + 1, phone: row.phone ?? '', reason: 'telefone inválido' });
        continue;
      }
      const contact = await this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM public.contacts WHERE account_id = $1 AND phone_number = $2 AND deleted_at IS NULL LIMIT 1`,
        [accountId, phone],
      );
      if (!contact.length) {
        result.errors.push({ row: i + 1, phone, reason: 'cliente não encontrado nesta conta' });
        continue;
      }
      if (!row.externalId?.trim() && !row.name?.trim()) {
        result.errors.push({
          row: i + 1,
          phone,
          reason: 'informe empresa_id ou nome da empresa',
        });
        continue;
      }
      const { id: companyId, created } = await this.resolveOrCreateCompany(accountId, {
        externalId: row.externalId,
        name: row.name,
      });
      if (created) result.created++;

      await this.tx.manager.query(
        `UPDATE public.contacts SET company_id = $1, updated_at = now() WHERE id = $2`,
        [companyId, contact[0].id],
      );
      result.linked++;
    }

    return result;
  }

  private async resolveOrCreateCompany(
    accountId: string,
    input: { companyId?: string | null; externalId?: string | null; name?: string | null },
  ): Promise<{ id: string; created: boolean }> {
    if (input.companyId) {
      const rows = await this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM public.companies WHERE id = $1 AND account_id = $2`,
        [input.companyId, accountId],
      );
      if (!rows.length) throw new BadRequestException('Empresa selecionada não pertence a esta conta.');
      return { id: rows[0].id, created: false };
    }

    const externalId = input.externalId?.trim() || null;
    if (externalId) {
      const existing = await this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM public.companies WHERE account_id = $1 AND external_id = $2`,
        [accountId, externalId],
      );
      if (existing.length) return { id: existing[0].id, created: false };
    }

    const name = input.name?.trim() || (externalId ? `Empresa ${externalId}` : null);
    if (!name) {
      throw new BadRequestException('Informe empresa_id ou o nome da empresa.');
    }
    const created = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO public.companies (account_id, name, external_id) VALUES ($1, $2, $3) RETURNING id`,
      [accountId, name, externalId],
    );
    return { id: created[0].id, created: true };
  }

  /**
   * Apaga a empresa e desvincula os clientes dela (contacts.company_id vira
   * null — o cliente continua existindo, só sem empresa). `contacts.company_id`
   * não tem ON DELETE CASCADE nem SET NULL (confdeltype 'n' — NO ACTION), então
   * sem isso o DELETE falharia com violação de FK sempre que houvesse cliente
   * vinculado.
   */
  async delete(accountId: string, id: string): Promise<void> {
    await this.tx.manager.query(
      `UPDATE public.contacts SET company_id = NULL, updated_at = now()
        WHERE company_id = $1 AND account_id = $2`,
      [id, accountId],
    );
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `DELETE FROM public.companies WHERE id = $1 AND account_id = $2 RETURNING id`,
      [id, accountId],
    );
    if (!rows.length) throw new NotFoundException('Empresa não encontrada');
  }

  /** Apaga TODAS as empresas desta conta e desvincula os clientes delas —
   * reset da tela Empresas, clientes continuam existindo. */
  async deleteAll(accountId: string): Promise<{ deleted: number }> {
    await this.tx.manager.query(
      `UPDATE public.contacts SET company_id = NULL, updated_at = now()
        WHERE account_id = $1 AND company_id IS NOT NULL`,
      [accountId],
    );
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `DELETE FROM public.companies WHERE account_id = $1 RETURNING id`,
      [accountId],
    );
    return { deleted: rows.length };
  }

  private async assertVendedorMembership(
    accountId: string,
    vendedorId: string,
  ): Promise<void> {
    const membership = await this.tx.manager.query<{ user_id: string }[]>(
      `SELECT user_id FROM public.account_users WHERE account_id = $1 AND user_id = $2`,
      [accountId, vendedorId],
    );
    if (membership.length === 0) {
      throw new BadRequestException('vendedorId não pertence a esta conta.');
    }
  }

  async get(accountId: string, id: string): Promise<CompanyRow> {
    const rows = await this.tx.manager.query<CompanyRow[]>(
      `SELECT id, account_id, name, razao_social, nome_fantasia, vendedor_id,
              vendedor_nome_erp, external_id
         FROM public.companies
        WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }

  async update(
    accountId: string,
    id: string,
    patch: {
      razaoSocial?: string | null;
      nomeFantasia?: string | null;
      vendedorId?: string | null;
    },
  ): Promise<CompanyRow> {
    // Mesmo guard de ContactsService.updateOps: class-transformer materializa
    // toda propriedade opcional declarada no DTO como chave própria contendo
    // undefined, então um filtro em Object.keys() sem descartar undefined
    // veria campos "presentes" mesmo quando o chamador não mandou nenhum —
    // e um SET vazio no SQL abaixo quebraria a query.
    const setFields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as typeof patch;
    if (Object.keys(setFields).length === 0) {
      throw new BadRequestException(
        'Nenhum campo atualizável informado. Campos aceitos: razaoSocial, nomeFantasia, vendedorId.',
      );
    }

    // vendedorId chega direto do body do caller — sem esta checagem, um
    // admin da conta A poderia atribuir a empresa a um usuário de outra
    // conta (ou a um UUID inexistente), já que a query de UPDATE abaixo só
    // filtra a companies pelo account_id, não o vendedor_id contra
    // account_users. O caminho de ingest (ingest_agent_contact) já resolve
    // o vendedor por nome dentro da própria conta — este é o único caminho
    // manual de escrita e precisava do mesmo cuidado.
    if (setFields.vendedorId != null) {
      await this.assertVendedorMembership(accountId, setFields.vendedorId);
    }

    const columnMap: Record<keyof typeof patch, string> = {
      razaoSocial: 'razao_social',
      nomeFantasia: 'nome_fantasia',
      vendedorId: 'vendedor_id',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(setFields)) {
      setClauses.push(`${columnMap[key as keyof typeof patch]} = $${i}`);
      values.push(value);
      i++;
    }
    setClauses.push('updated_at = now()');
    values.push(id, accountId);

    const rows = await this.tx.manager.query<{ id: string }[]>(
      `UPDATE public.companies SET ${setClauses.join(', ')}
        WHERE id = $${i} AND account_id = $${i + 1}
        RETURNING id`,
      values,
    );
    if (!rows.length) throw new NotFoundException('Empresa não encontrada');
    return this.get(accountId, id);
  }
}

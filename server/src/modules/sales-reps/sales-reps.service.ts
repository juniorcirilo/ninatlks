import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { BulkSalesRepsDto, UpsertSalesRepDto } from './dto/sales-rep.dto';
import { normalizeE164, normalizeVendedorKey } from './sales-reps.util';

export interface SalesRepRow {
  id: string;
  nome: string;
  aliases: string[];
  phone_e164: string | null;
  email: string | null;
  user_id: string | null;
  active: boolean;
  departamento: 'COMERCIAL' | 'FINANCEIRO';
  is_default: boolean;
  nome_falado: string | null;
}

@Injectable()
export class SalesRepsService {
  constructor(private readonly tx: TenantTxHost) {}

  list(accountId: string): Promise<SalesRepRow[]> {
    return this.tx.manager.query(
      `SELECT id, nome, aliases, phone_e164, email, user_id, active, departamento, is_default, nome_falado
         FROM public.sales_reps WHERE account_id = $1 ORDER BY departamento, is_default DESC, nome ASC`,
      [accountId],
    );
  }

  listPendencias(accountId: string) {
    return this.tx.manager.query(
      `SELECT id, departamento, vendedor_nome, vendedor_key, reason, campaign_id, fallback_number,
              occurrences, first_seen_at, last_seen_at
         FROM public.sales_rep_pendencias
        WHERE account_id = $1 AND resolved_at IS NULL
        ORDER BY last_seen_at DESC LIMIT 500`,
      [accountId],
    );
  }

  async create(accountId: string, dto: UpsertSalesRepDto): Promise<SalesRepRow> {
    const f = this.prepare(dto);
    if (f.isDefault) await this.clearDefault(accountId, f.departamento, null);
    const rows = await this.tx.manager.query<SalesRepRow[]>(
      `INSERT INTO public.sales_reps
         (account_id, nome, aliases, match_keys, phone_e164, email, user_id, active,
          departamento, is_default, nome_falado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, nome, aliases, phone_e164, email, user_id, active, departamento, is_default, nome_falado`,
      [accountId, f.nome, f.aliases, f.keys, f.phone, f.email, f.userId, f.active,
        f.departamento, f.isDefault, f.nomeFalado],
    );
    await this.resolvePendencias(accountId, f.keys, f.phone, f.departamento, f.isDefault);
    return rows[0];
  }

  async update(accountId: string, id: string, dto: UpsertSalesRepDto): Promise<SalesRepRow> {
    const f = this.prepare(dto);
    if (f.isDefault) await this.clearDefault(accountId, f.departamento, id);
    const rows = await this.tx.manager.query<SalesRepRow[]>(
      `UPDATE public.sales_reps
          SET nome = $3, aliases = $4, match_keys = $5, phone_e164 = $6,
              email = $7, user_id = $8, active = $9,
              departamento = $10, is_default = $11, nome_falado = $12
        WHERE id = $1 AND account_id = $2
        RETURNING id, nome, aliases, phone_e164, email, user_id, active, departamento, is_default, nome_falado`,
      [id, accountId, f.nome, f.aliases, f.keys, f.phone, f.email, f.userId, f.active,
        f.departamento, f.isDefault, f.nomeFalado],
    );
    if (!rows[0]) throw new NotFoundException('Vendedor não encontrado.');
    await this.resolvePendencias(accountId, f.keys, f.phone, f.departamento, f.isDefault);
    return rows[0];
  }

  async remove(accountId: string, id: string): Promise<{ ok: true }> {
    await this.tx.manager.query(
      `DELETE FROM public.sales_reps WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    return { ok: true };
  }

  /** Importação em massa (lista inicial do ERP): upsert por nome normalizado. */
  async bulk(accountId: string, dto: BulkSalesRepsDto) {
    let created = 0;
    let updated = 0;
    const errors: { nome: string; error: string }[] = [];
    for (const item of dto.items) {
      try {
        const f = this.prepare(item);
        const existing = await this.tx.manager.query<{ id: string }[]>(
          `SELECT id FROM public.sales_reps
              WHERE account_id = $1 AND departamento = $3 AND $2 = ANY(match_keys) LIMIT 1`,
          [accountId, normalizeVendedorKey(f.nome), f.departamento],
        );
        if (existing[0]) {
          await this.update(accountId, existing[0].id, item);
          updated++;
        } else {
          await this.create(accountId, item);
          created++;
        }
      } catch (err) {
        errors.push({ nome: item.nome, error: (err as Error).message });
      }
    }
    return { created, updated, errors };
  }

  private prepare(dto: UpsertSalesRepDto) {
    const nome = dto.nome.trim();
    const aliases = (dto.aliases ?? []).map((a) => a.trim()).filter(Boolean);
    const keys = [
      ...new Set([nome, ...aliases].map(normalizeVendedorKey).filter(Boolean)),
    ];
    if (keys.length === 0) throw new BadRequestException('Nome inválido.');
    let phone: string | null = null;
    if (dto.phone != null && dto.phone.trim() !== '') {
      phone = normalizeE164(dto.phone);
      if (!phone) throw new BadRequestException(`Telefone inválido: "${dto.phone}".`);
    }
    const departamento = dto.departamento ?? 'COMERCIAL';
    const isDefault = dto.isDefault ?? false;
    if (isDefault && !phone) {
      throw new BadRequestException('Atendente padrão precisa de telefone.');
    }
    return {
      departamento,
      isDefault,
      nomeFalado: dto.nomeFalado?.trim() || null,
      nome,
      aliases,
      keys,
      phone,
      email: dto.email?.trim() || null,
      userId: dto.userId ?? null,
      active: dto.active ?? true,
    };
  }

  /** Só um atendente padrão ativo por conta+departamento (índice único parcial no banco). */
  private async clearDefault(accountId: string, departamento: string, exceptId: string | null) {
    await this.tx.manager.query(
      `UPDATE public.sales_reps SET is_default = false
        WHERE account_id = $1 AND departamento = $2 AND is_default
          AND ($3::uuid IS NULL OR id <> $3)`,
      [accountId, departamento, exceptId],
    );
  }

  /** Cadastrou/atualizou com telefone → fecha as pendências desse vendedor; padrão → fecha sem_atendente_padrao. */
  private async resolvePendencias(
    accountId: string,
    keys: string[],
    phone: string | null,
    departamento: string,
    isDefault: boolean,
  ) {
    if (!phone) return;
    await this.tx.manager.query(
      `UPDATE public.sales_rep_pendencias SET resolved_at = now()
        WHERE account_id = $1 AND resolved_at IS NULL
          AND ((departamento = $3 AND vendedor_key = ANY($2))
               OR ($4 AND departamento = $3 AND reason = 'sem_atendente_padrao'))`,
      [accountId, keys, departamento, isDefault],
    );
  }
}

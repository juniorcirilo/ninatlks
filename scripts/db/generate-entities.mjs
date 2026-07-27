#!/usr/bin/env node
// Generates TypeORM entity classes by introspecting the local Postgres
// (after `npm run migration:run` inside server/ has applied all 143 ported
// migrations) — the schema is the source of truth here, not a hand-written
// guess. Run from repo root: DATABASE_URL=... node scripts/db/generate-entities.mjs
//
// Scope: columns, types, nullability, defaults, primary key. Relations
// (@ManyToOne/@OneToMany) are intentionally NOT generated — with 95 tables
// and heavy cross-domain FKs, inferring relation ownership/inverse sides
// automatically is error-prone; each domain module (Fase 4) adds the
// relations it actually needs when it's built, informed by real usage.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from '../../server/node_modules/pg/lib/index.js';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const ENTITIES_DIR = join(REPO_ROOT, 'server', 'src', 'database', 'entities');

const DATABASE_URL = (process.env.DATABASE_URL || '').replace('@postgres:', '@localhost:');
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (pointing at the local Postgres, e.g. via localhost:5432)');
  process.exit(1);
}

// Table -> domain subfolder, grouping to match the structure already
// scaffolded in Fase 1. Anything not listed falls into database/entities/misc/.
const DOMAIN_MAP = {
  accounts: [
    'accounts', 'account_users', 'account_secrets', 'user_roles', 'agent_roles',
    'invites', 'profiles', 'sessions', 'app_settings', 'system_settings', 'org_onboarding_state',
    'companies', 'company_settings', 'audit_log',
  ],
  contacts: [
    'contacts', 'contact_lists', 'contact_list_members', 'contact_tags',
    'contact_inboxes', 'contact_dossiers', 'contact_facts', 'dnc_list', 'sms_opt_outs',
  ],
  conversations: [
    'conversations', 'messages', 'conversation_outcomes', 'conversation_signals',
    'conversation_checkpoints', 'conversation_replays', 'outcome_attributions',
    'csat_surveys', 'message_dispatch_queue', 'customer_memory_nodes', 'customer_memory_edges',
    'incident_clusters', 'incident_cluster_members', 'agent_handoffs', 'live_sessions', 'live_takeovers',
  ],
  voice: [
    'voice_calls', 'voice_campaigns', 'voice_campaign_contacts', 'phone_numbers',
    'inboxes', 'channels', 'channel_usage_metrics', 'twilio_number_provisioning',
    'call_attempts_log', 'call_outcomes_catalog', 'elevenlabs_usage_log', 'campaign_runs',
  ],
  campaigns: ['follow_up_cadences', 'follow_up_executions', 'promise_followups', 'escalation_rules'],
  meetings: [
    'doctors', 'doctor_availability', 'doctor_blocks', 'scheduled_meetings',
    'calendar_availability', 'calendar_blocks', 'calendar_integrations', 'holidays_br',
  ],
  personas: [
    'agent_personas', 'agent_persona_deployments', 'agent_persona_samples',
    'persona_improvement_attempts', 'prompt_templates', 'prompt_versions', 'prompt_deployments',
    'playbooks', 'whatsapp_templates',
  ],
  workflows: ['workflows', 'workflow_events', 'workflow_runs', 'memory_extraction_state'],
  evals: ['eval_scenarios', 'eval_runs', 'eval_conversations'],
  notifications: ['notifications'],
  webhooks: ['webhook_deliveries', 'integration_sync_queue'],
  shared: [
    'retention_rules', 'data_deletion_requests', 'crm_deals', 'crm_integrations',
    'crm_pipelines', 'crm_pipeline_stages', 'lead_pipelines', 'lead_sources', 'lead_stages',
    'billing_integrations', 'payments_ledger', 'glass_fittings', 'glass_types',
  ],
};

const TABLE_TO_DOMAIN = {};
for (const [domain, tables] of Object.entries(DOMAIN_MAP)) {
  for (const t of tables) TABLE_TO_DOMAIN[t] = domain;
}

// Postgres type -> [TypeORM column type, TS type]
function mapType(pgType, udtName) {
  switch (pgType) {
    case 'uuid':
      return ['uuid', 'string'];
    case 'text':
    case 'character varying':
    case 'varchar':
      return ['text', 'string'];
    case 'boolean':
      return ['boolean', 'boolean'];
    case 'integer':
      return ['integer', 'number'];
    case 'bigint':
      return ['bigint', 'string'];
    case 'smallint':
      return ['smallint', 'number'];
    case 'numeric':
    case 'real':
    case 'double precision':
      return ['numeric', 'number'];
    case 'jsonb':
      return ['jsonb', 'Record<string, unknown>'];
    case 'json':
      return ['json', 'Record<string, unknown>'];
    case 'timestamp with time zone':
      return ['timestamptz', 'Date'];
    case 'timestamp without time zone':
      return ['timestamp', 'Date'];
    case 'date':
      return ['date', 'Date'];
    case 'inet':
      return ['inet', 'string'];
    case 'ARRAY': {
      const inner = udtName?.startsWith('_') ? udtName.slice(1) : 'text';
      const [, tsInner] = mapType(inner, null);
      return [`${inner === 'text' ? 'text' : inner}`, `${tsInner}[]`, true];
    }
    case 'USER-DEFINED':
      // enums (app_role, etc.) and vector — handled by caller via udtName
      return ['__user_defined__', 'string'];
    default:
      return ['text', 'string'];
  }
}

function toPascalCase(snake) {
  return snake
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function toCamelCase(snake) {
  const pascal = toPascalCase(snake);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

function sanitizeDefault(raw, tsType) {
  if (raw == null) return undefined;
  // Strip Postgres's ::type casts and surrounding parens Postgres adds to defaults.
  let v = raw.replace(/::[a-zA-Z0-9_ ]+(\[\])?$/, '').trim();
  if (v === 'now()' || v === 'CURRENT_TIMESTAMP') return undefined; // handled by @CreateDateColumn where relevant
  if (v === 'gen_random_uuid()') return undefined; // handled by @PrimaryGeneratedColumn('uuid')
  if (/^'.*'$/.test(v)) {
    const inner = v.slice(1, -1).replace(/''/g, "'");
    return JSON.stringify(inner);
  }
  if (v === 'true' || v === 'false') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return undefined; // anything else (functions, expressions) — leave unset, not safe to inline
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const tablesRes = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'migrations'
    ORDER BY table_name
  `);
  const tables = tablesRes.rows.map((r) => r.table_name);

  const pkRes = await client.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
  `);
  const pkByTable = new Map();
  for (const row of pkRes.rows) {
    if (!pkByTable.has(row.table_name)) pkByTable.set(row.table_name, new Set());
    pkByTable.get(row.table_name).add(row.column_name);
  }

  const identityRes = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
  `);
  const identityCols = new Set(identityRes.rows.map((r) => `${r.table_name}.${r.column_name}`));

  let generated = 0;
  const domainCounts = {};

  for (const table of tables) {
    const colsRes = await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );

    const pkCols = pkByTable.get(table) ?? new Set();
    const domain = TABLE_TO_DOMAIN[table] ?? 'misc';
    domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;

    // No de-pluralization: PascalCase the raw table name as-is (avoids
    // mangling names like "companies" via naive singularization rules).
    const entityClassName = toPascalCase(table);

    const lines = [];
    const usedDecorators = new Set();
    lines.push(`@Entity('${table}')`);
    lines.push(`export class ${entityClassName} {`);

    for (const col of colsRes.rows) {
      const isPk = pkCols.has(col.column_name);
      const isIdentity = identityCols.has(`${table}.${col.column_name}`);
      const propName = toCamelCase(col.column_name);
      const nullable = col.is_nullable === 'YES' && !isPk;

      if (isPk && col.data_type === 'uuid' && col.column_default === 'gen_random_uuid()') {
        usedDecorators.add('PrimaryGeneratedColumn');
        lines.push(`  @PrimaryGeneratedColumn('uuid', { name: '${col.column_name}' })`);
        lines.push(`  ${propName}!: string;`);
        lines.push('');
        continue;
      }
      if (isPk && isIdentity) {
        usedDecorators.add('PrimaryGeneratedColumn');
        lines.push(`  @PrimaryGeneratedColumn({ name: '${col.column_name}' })`);
        lines.push(`  ${propName}!: ${col.data_type === 'bigint' ? 'string' : 'number'};`);
        lines.push('');
        continue;
      }

      let ormType;
      let tsType;
      let isArray = false;
      let isEnum = false;
      let isVector = false;
      if (col.data_type === 'USER-DEFINED') {
        if (col.udt_name === 'vector') {
          isVector = true;
          ormType = 'text'; // TypeORM has no native pgvector type; DB column stays `vector(1536)` regardless.
          tsType = 'number[]';
        } else {
          isEnum = true; // Postgres enum type (e.g. app_role) — DB enforces it regardless of TS type here.
          ormType = 'text';
          tsType = 'string';
        }
      } else {
        [ormType, tsType, isArray] = mapType(col.data_type, col.udt_name);
      }

      if (isPk) {
        usedDecorators.add('PrimaryColumn');
        lines.push(`  @PrimaryColumn('${ormType}', { name: '${col.column_name}' })`);
        lines.push(`  ${propName}!: ${tsType};`);
        lines.push('');
        continue;
      }

      const opts = [`name: '${col.column_name}'`];
      if (isArray) opts.push('array: true');
      if (nullable) opts.push('nullable: true');
      const def = sanitizeDefault(col.column_default, tsType);
      if (def !== undefined) opts.push(`default: ${def}`);

      const note = isEnum
        ? ` // Postgres enum "${col.udt_name}" — stored/read as text; DB still enforces the enum constraint.`
        : isVector
          ? ` // pgvector "vector(1536)" — no native TypeORM type; DB column is unaffected by this.`
          : '';
      usedDecorators.add('Column');
      lines.push(`  @Column('${ormType}', { ${opts.join(', ')} })${note}`);
      lines.push(`  ${propName}${nullable ? '?' : '!'}: ${tsType}${nullable ? ' | null' : ''};`);
      lines.push('');
    }

    lines.push('}');
    lines.push('');

    const importOrder = ['Entity', 'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn'];
    const imports = importOrder.filter((d) => d === 'Entity' || usedDecorators.has(d));
    lines.unshift(`import { ${imports.join(', ')} } from 'typeorm';`, '');

    const domainDir = join(ENTITIES_DIR, domain);
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(join(domainDir, `${table}.entity.ts`), lines.join('\n'));
    generated++;
  }

  console.log(`Generated ${generated} entities across ${Object.keys(domainCounts).length} domains:`);
  for (const [d, c] of Object.entries(domainCounts).sort()) console.log(`  ${d}: ${c}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

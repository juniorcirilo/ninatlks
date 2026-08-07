import { MigrationInterface, QueryRunner } from 'typeorm';

// Removes the last piece of the Supabase-era auto-reply path:
// `trg_messages_auto_reply` (attached in 20260416174815-Migration.ts, body
// last replaced in 20260423191559-Migration.ts) fired `pg_net.http_post` on
// every inbound `messages` INSERT against `{SUPABASE_URL}/functions/v1/
// persona-auto-reply` — a Deno Edge Function that was never ported into
// this backend, with a fallback URL hardcoded to the old Supabase project.
// If that project were ever decommissioned, WhatsApp/SMS auto-reply would
// silently stop working (the trigger swallows the exception into
// `audit_log` and returns NEW either way).
//
// PersonaAutoReplyService (server/src/modules/messages/) now does this
// in-process, called directly from InboundMessageService.ingest() right
// after insert — see 20260807110000-PersonaAutoReplyBypass.ts for the
// SECURITY DEFINER functions it uses. No replacement trigger needed.
export class DropLegacyAutoReplyTrigger20260807120000
  implements MigrationInterface
{
  name = 'DropLegacyAutoReplyTrigger20260807120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_messages_auto_reply ON public.messages;`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.tg_trigger_auto_reply();`,
    );
  }

  public down(): Promise<void> {
    throw new Error(
      'DropLegacyAutoReplyTrigger20260807120000 has no down migration — the trigger it removes called out to a Supabase project/Edge Function that this backend no longer depends on; restoring it would silently reintroduce that dependency. Auto-reply is handled by PersonaAutoReplyService instead.',
    );
  }
}

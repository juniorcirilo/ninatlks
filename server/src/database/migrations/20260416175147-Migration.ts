import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416175147_0c02e75d-fb4f-4ed7-957b-31e9d0676362.sql.
export class Migration20260416175147 implements MigrationInterface {
  name = 'Migration20260416175147';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- prompt_versions: versionamento de prompts
CREATE TABLE public.prompt_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  slug VARCHAR(120) NOT NULL,
  version INT NOT NULL,
  parent_version_id BIGINT REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  eval_score REAL,
  change_note TEXT,
  author VARCHAR(20) NOT NULL DEFAULT 'human',
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prompt_versions_status_chk CHECK (status IN ('draft','staging','prod','retired')),
  CONSTRAINT prompt_versions_author_chk CHECK (author IN ('human','auto')),
  CONSTRAINT prompt_versions_unique_slug_version UNIQUE (account_id, slug, version)
);
`);
    await queryRunner.query(`
CREATE INDEX idx_prompt_versions_slug_status ON public.prompt_versions(account_id, slug, status);
`);
    await queryRunner.query(`
CREATE INDEX idx_prompt_versions_account ON public.prompt_versions(account_id);
`);
    await queryRunner.query(`
CREATE TRIGGER trg_prompt_versions_updated_at
  BEFORE UPDATE ON public.prompt_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY pv_select_member ON public.prompt_versions FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY pv_insert_admin ON public.prompt_versions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY pv_update_admin ON public.prompt_versions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY pv_delete_admin ON public.prompt_versions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- prompt_deployments: vincula versão a inbox/persona com traffic share
CREATE TABLE public.prompt_deployments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  prompt_version_id BIGINT NOT NULL REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  inbox_id UUID REFERENCES public.inboxes(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  traffic_share REAL NOT NULL DEFAULT 1.0 CHECK (traffic_share >= 0 AND traffic_share <= 1),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_prompt_deployments_version ON public.prompt_deployments(prompt_version_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_prompt_deployments_inbox ON public.prompt_deployments(inbox_id) WHERE inbox_id IS NOT NULL;
`);
    await queryRunner.query(`
CREATE INDEX idx_prompt_deployments_persona ON public.prompt_deployments(persona_id) WHERE persona_id IS NOT NULL;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_prompt_deployments_updated_at
  BEFORE UPDATE ON public.prompt_deployments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
ALTER TABLE public.prompt_deployments ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY pd_select_member ON public.prompt_deployments FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY pd_insert_admin ON public.prompt_deployments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY pd_update_admin ON public.prompt_deployments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY pd_delete_admin ON public.prompt_deployments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416175147 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260520181346_0f04b9f8-4693-4412-af26-21fd0eebd2e4.sql.
export class Migration20260520181346 implements MigrationInterface {
  name = 'Migration20260520181346';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- 1. ai_summary em voice_calls
ALTER TABLE public.voice_calls ADD COLUMN IF NOT EXISTS ai_summary text;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_voice_calls_account_ai_summary
  ON public.voice_calls (account_id) WHERE ai_summary IS NOT NULL;
`);
    await queryRunner.query(`
-- 2. Catálogo de outcomes por tipo de campanha
CREATE TABLE IF NOT EXISTS public.call_outcomes_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_kind text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  score smallint NOT NULL DEFAULT 0,
  terminal boolean NOT NULL DEFAULT false,
  color text,
  position smallint NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, campaign_kind, code)
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_call_outcomes_catalog_kind
  ON public.call_outcomes_catalog (campaign_kind, account_id);
`);
    await queryRunner.query(`
ALTER TABLE public.call_outcomes_catalog ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "outcomes_catalog_select"
  ON public.call_outcomes_catalog FOR SELECT
  USING (account_id IS NULL OR public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "outcomes_catalog_insert"
  ON public.call_outcomes_catalog FOR INSERT
  WITH CHECK (account_id IS NOT NULL AND public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "outcomes_catalog_update"
  ON public.call_outcomes_catalog FOR UPDATE
  USING (account_id IS NOT NULL AND public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "outcomes_catalog_delete"
  ON public.call_outcomes_catalog FOR DELETE
  USING (account_id IS NOT NULL AND public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- Seed defaults globais (account_id = NULL) por tipo de operação
INSERT INTO public.call_outcomes_catalog (account_id, campaign_kind, code, label, description, score, terminal, color, position, is_default) VALUES
  -- SDR
  (NULL,'sdr','scheduled','Reunião agendada','Lead aceitou agendar reunião/consulta',95,true,'#16a34a',1,true),
  (NULL,'sdr','qualified','Qualificado','Tem fit e interesse, mas não agendou',70,false,'#22c55e',2,true),
  (NULL,'sdr','callback','Pediu retorno','Quer ser contatado depois',50,false,'#eab308',3,true),
  (NULL,'sdr','not_interested','Sem interesse','Sem fit / recusou',5,true,'#ef4444',4,true),
  (NULL,'sdr','no_answer','Sem resposta','Não atendeu ou caiu',20,false,'#94a3b8',5,true),
  (NULL,'sdr','voicemail','Caixa postal','Mensagem deixada',15,false,'#94a3b8',6,true),
  (NULL,'sdr','wrong_number','Número errado','Pessoa errada',0,true,'#64748b',7,true),
  (NULL,'sdr','escalated','Pediu humano','Solicitou transferência',60,false,'#3b82f6',8,true),
  -- COBRANÇA
  (NULL,'cobranca','prometeu_pagar','Promessa de pagamento','Cliente confirmou data de pagamento',85,true,'#16a34a',1,true),
  (NULL,'cobranca','quitou','Pagou na hora','Pagamento confirmado durante a ligação',100,true,'#15803d',2,true),
  (NULL,'cobranca','negociou_parcelas','Negociou parcelas','Aceitou parcelar a dívida',75,true,'#22c55e',3,true),
  (NULL,'cobranca','pediu_boleto','Pediu boleto/PIX','Solicitou envio de boleto ou PIX',65,false,'#eab308',4,true),
  (NULL,'cobranca','contestou_divida','Contestou dívida','Não reconhece a dívida',20,true,'#f97316',5,true),
  (NULL,'cobranca','sem_condicoes','Sem condições','Alegou impossibilidade financeira',15,false,'#ef4444',6,true),
  (NULL,'cobranca','recusou_pagar','Recusou pagar','Disse que não vai pagar',5,true,'#dc2626',7,true),
  (NULL,'cobranca','no_answer','Sem resposta','Não atendeu',10,false,'#94a3b8',8,true),
  (NULL,'cobranca','wrong_number','Número errado','Pessoa errada',0,true,'#64748b',9,true),
  -- PÓS-VENDA
  (NULL,'pos_venda','satisfeito','Cliente satisfeito','Experiência positiva, sem problemas',90,true,'#16a34a',1,true),
  (NULL,'pos_venda','indicou','Indicou alguém','Forneceu indicação',95,true,'#15803d',2,true),
  (NULL,'pos_venda','recompra','Interessado em recompra','Quer comprar novamente',100,true,'#15803d',3,true),
  (NULL,'pos_venda','duvida','Tirou dúvida','Pergunta resolvida',60,true,'#22c55e',4,true),
  (NULL,'pos_venda','problema_resolvido','Problema resolvido','Reclamação tratada na ligação',70,true,'#eab308',5,true),
  (NULL,'pos_venda','problema_pendente','Problema em aberto','Precisa escalar para humano',40,false,'#f97316',6,true),
  (NULL,'pos_venda','insatisfeito','Insatisfeito','Cliente sinalizou churn',15,false,'#ef4444',7,true),
  (NULL,'pos_venda','no_answer','Sem resposta','Não atendeu',20,false,'#94a3b8',8,true),
  -- RETENÇÃO
  (NULL,'retencao','retido','Cliente retido','Aceitou continuar',95,true,'#16a34a',1,true),
  (NULL,'retencao','aceitou_oferta','Aceitou oferta','Aceitou desconto/upgrade',90,true,'#22c55e',2,true),
  (NULL,'retencao','pediu_tempo','Pediu para pensar','Quer prazo para decidir',55,false,'#eab308',3,true),
  (NULL,'retencao','escalou_humano','Escalou para humano','Pediu falar com retenção humana',60,false,'#3b82f6',4,true),
  (NULL,'retencao','cancelou','Confirmou cancelamento','Decidiu cancelar mesmo assim',10,true,'#ef4444',5,true),
  (NULL,'retencao','reativou','Reativou serviço','Cliente inativo voltou',95,true,'#15803d',6,true),
  (NULL,'retencao','no_answer','Sem resposta','Não atendeu',20,false,'#94a3b8',7,true)
ON CONFLICT DO NOTHING;
`);
    await queryRunner.query(`
-- 3. Listas de contatos
CREATE TABLE IF NOT EXISTS public.contact_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  campaign_kind text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_dynamic boolean NOT NULL DEFAULT false,
  member_count integer NOT NULL DEFAULT 0,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contact_lists_account ON public.contact_lists (account_id, created_at DESC);
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.contact_list_members (
  list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contact_list_members_contact ON public.contact_list_members (contact_id);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contact_list_members_account ON public.contact_list_members (account_id);
`);
    await queryRunner.query(`
ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "lists_select" ON public.contact_lists FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "lists_insert" ON public.contact_lists FOR INSERT
  WITH CHECK (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "lists_update" ON public.contact_lists FOR UPDATE
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "lists_delete" ON public.contact_lists FOR DELETE
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "list_members_select" ON public.contact_list_members FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "list_members_insert" ON public.contact_list_members FOR INSERT
  WITH CHECK (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "list_members_delete" ON public.contact_list_members FOR DELETE
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- Trigger contagem de membros
CREATE OR REPLACE FUNCTION public.tg_contact_list_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.contact_lists SET member_count = member_count + 1, updated_at = now() WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.contact_lists SET member_count = GREATEST(member_count - 1, 0), updated_at = now() WHERE id = OLD.list_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_contact_list_count ON public.contact_list_members;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_contact_list_count
  AFTER INSERT OR DELETE ON public.contact_list_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_contact_list_count();
`);
    await queryRunner.query(`
-- 4. campaign_kind: ajusta default para 'sdr' (não force CHECK por enquanto)
ALTER TABLE public.voice_campaigns ALTER COLUMN campaign_kind SET DEFAULT 'sdr';
`);
    await queryRunner.query(`
COMMENT ON COLUMN public.voice_campaigns.campaign_kind IS
  'Tipo da operação: sdr | pos_venda | cobranca | retencao | custom (collection = legacy)';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260520181346 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

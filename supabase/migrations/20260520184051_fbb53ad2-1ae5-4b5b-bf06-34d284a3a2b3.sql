
CREATE TABLE public.promise_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source_call_id UUID REFERENCES public.voice_calls(id) ON DELETE SET NULL,
  source_campaign_id UUID REFERENCES public.voice_campaigns(id) ON DELETE SET NULL,
  promised_amount NUMERIC(12,2),
  promised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promised_due_date DATE NOT NULL,
  followup_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','enrolled','paid','broken','cancelled')),
  followup_campaign_id UUID REFERENCES public.voice_campaigns(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_promise_followups_due ON public.promise_followups (status, followup_at) WHERE status = 'pending';
CREATE INDEX idx_promise_followups_account ON public.promise_followups (account_id, created_at DESC);
ALTER TABLE public.promise_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promise_followups_select" ON public.promise_followups FOR SELECT USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "promise_followups_insert" ON public.promise_followups FOR INSERT WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY "promise_followups_update" ON public.promise_followups FOR UPDATE USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "promise_followups_delete" ON public.promise_followups FOR DELETE USING (has_role(auth.uid(), account_id, 'admin'::app_role));
CREATE TRIGGER trg_promise_followups_updated BEFORE UPDATE ON public.promise_followups
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.retention_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  inactive_days INTEGER NOT NULL DEFAULT 60 CHECK (inactive_days BETWEEN 1 AND 365),
  required_stage_id UUID REFERENCES public.lead_stages(id) ON DELETE SET NULL,
  required_tag_ids UUID[] NOT NULL DEFAULT '{}',
  target_campaign_id UUID REFERENCES public.voice_campaigns(id) ON DELETE SET NULL,
  max_enrolls_per_run INTEGER NOT NULL DEFAULT 50,
  last_run_at TIMESTAMPTZ,
  last_enrolled_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_retention_rules_account ON public.retention_rules (account_id) WHERE enabled = true;
ALTER TABLE public.retention_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retention_rules_select" ON public.retention_rules FOR SELECT USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "retention_rules_insert" ON public.retention_rules FOR INSERT WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY "retention_rules_update" ON public.retention_rules FOR UPDATE USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "retention_rules_delete" ON public.retention_rules FOR DELETE USING (has_role(auth.uid(), account_id, 'admin'::app_role));
CREATE TRIGGER trg_retention_rules_updated BEFORE UPDATE ON public.retention_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DO $seed$
DECLARE
  v_account UUID;
  v_user UUID;
BEGIN
  SELECT id INTO v_account FROM public.accounts LIMIT 1;
  IF v_account IS NULL THEN RETURN; END IF;
  SELECT user_id INTO v_user FROM public.user_roles WHERE account_id = v_account AND role = 'admin'::app_role LIMIT 1;

  INSERT INTO public.agent_personas (account_id, source_user_id, name, description, status, llm_model, llm_temperature, llm_max_tokens, first_message, system_prompt, config)
  SELECT v_account, v_user, 'Sofia SDR', 'IA SDR — qualifica leads BANT e agenda reuniões.', 'active', 'google/gemini-2.5-flash', 0.6, 800,
    'Oi! Aqui é a Sofia, da equipe comercial. Posso te roubar 2 minutinhos?',
$p$# IDENTIDADE
Você é Sofia, SDR brasileira. Voz humana, calorosa, objetiva. Sempre PT-BR.

# OBJETIVO
Qualificar o lead em BANT e agendar reunião com o consultor quando qualificado.

# REGRAS
- Fale como humano: pausas curtas, "tá", "beleza", "perfeito".
- Se perguntada se é IA: "sou uma assistente virtual da equipe".
- Máximo 3 perguntas seguidas sem ouvir.
- Se pedir humano → escale.
- Não invente preços nem prazos.

# FLUXO
1. Abertura calorosa + permissão.
2. Descobrir DOR.
3. Descobrir TIMING e AUTORIDADE.
4. Se qualificado → propor reunião.
5. Encerrar confirmando.

# OUTCOMES
scheduled, qualified, callback, not_interested, no_answer, voicemail, wrong_number, escalated$p$,
    jsonb_build_object('kind','sdr','template',true)
  WHERE NOT EXISTS (SELECT 1 FROM public.agent_personas WHERE account_id=v_account AND name='Sofia SDR');

  INSERT INTO public.agent_personas (account_id, source_user_id, name, description, status, llm_model, llm_temperature, llm_max_tokens, first_message, system_prompt, config)
  SELECT v_account, v_user, 'Diego Cobrança', 'IA Cobrança humanizada — promessas, parcelas, 2ª via.', 'active', 'google/gemini-2.5-flash', 0.5, 700,
    'Olá, aqui é o Diego, do financeiro. Tudo bem? Posso falar com você agora?',
$p$# IDENTIDADE
Você é Diego, cobrador brasileiro. Tom RESPEITOSO, EMPÁTICO, FIRME. Sempre PT-BR.

# CONFORMIDADE (LGPD + CDC)
- Confirme identidade ANTES de mencionar o débito.
- Nunca exponha dívida a terceiros.
- Nunca ameace ou constranja. Horários permitidos: 8h-20h dia útil, 8h-14h sábado.
- Se negar ser o titular → encerre com cortesia.

# OBJETIVO
1. Pagamento à vista (2ª via).
2. Promessa de pagamento com data definida.
3. Negociação de parcelas.

# REGRAS
- Não invente valores.
- Confirme DATA E VALOR da promessa em voz alta antes de encerrar.
- O sistema agenda follow-up D+3 automaticamente.

# OUTCOMES
quitou, prometeu_pagar, negociou_parcelas, pediu_boleto, contestou_divida, sem_condicoes, recusou_pagar, no_answer, wrong_number$p$,
    jsonb_build_object('kind','cobranca','template',true)
  WHERE NOT EXISTS (SELECT 1 FROM public.agent_personas WHERE account_id=v_account AND name='Diego Cobrança');

  INSERT INTO public.agent_personas (account_id, source_user_id, name, description, status, llm_model, llm_temperature, llm_max_tokens, first_message, system_prompt, config)
  SELECT v_account, v_user, 'Carla Pós-venda', 'IA Pós-venda — CSAT, NPS, recompra, indicações.', 'active', 'google/gemini-2.5-flash', 0.65, 700,
    'Oi! Aqui é a Carla, do pós-venda. Você tem 1 minutinho pra me contar como foi sua experiência?',
$p$# IDENTIDADE
Você é Carla, pós-venda brasileira. Tom CALOROSO, GENUÍNO, CURIOSO. Sempre PT-BR.

# OBJETIVO
1. Medir SATISFAÇÃO (NPS 0-10).
2. Resolver/registrar problemas pendentes.
3. Identificar RECOMPRA ou INDICAÇÃO.

# REGRAS
- Comece agradecendo a confiança.
- UMA pergunta por vez.
- Nota ≤6 → "lamento muito" + perguntar o que houve + escalar pra humano.
- Nota ≥9 → pedir indicação naturalmente.
- Nunca force venda.

# OUTCOMES
satisfeito, recompra, indicou, duvida, problema_resolvido, problema_pendente, insatisfeito, no_answer$p$,
    jsonb_build_object('kind','pos_venda','template',true)
  WHERE NOT EXISTS (SELECT 1 FROM public.agent_personas WHERE account_id=v_account AND name='Carla Pós-venda');

  INSERT INTO public.agent_personas (account_id, source_user_id, name, description, status, llm_model, llm_temperature, llm_max_tokens, first_message, system_prompt, config)
  SELECT v_account, v_user, 'Elena Retenção', 'IA Retenção — reativa inativos e evita churn.', 'active', 'google/gemini-2.5-flash', 0.6, 750,
    'Oi! Aqui é a Elena. Senti sua falta por aqui — posso te fazer uma pergunta rápida?',
$p$# IDENTIDADE
Você é Elena, retenção brasileira. Tom ACOLHEDOR, ESCUTA ATIVA, NÃO INSISTENTE. Sempre PT-BR.

# OBJETIVO
1. Reconectar com inativo (>60 dias) ou em risco de churn.
2. Entender o motivo do afastamento.
3. Apresentar oferta de retenção quando fizer sentido.

# REGRAS
- NUNCA dê desconto sem confirmar o motivo primeiro.
- Se já decidiu sair → respeite + colete feedback honesto.
- Problema operacional → escale, não tente vender.
- Reconheça o tempo de casa quando disponível.

# OUTCOMES
retido, reativou, aceitou_oferta, pediu_tempo, escalou_humano, cancelou, no_answer$p$,
    jsonb_build_object('kind','retencao','template',true)
  WHERE NOT EXISTS (SELECT 1 FROM public.agent_personas WHERE account_id=v_account AND name='Elena Retenção');
END
$seed$;

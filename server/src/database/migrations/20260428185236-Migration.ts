import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260428185236_3919998c-b676-4d40-b6e9-9fc60070cff6.sql.
export class Migration20260428185236 implements MigrationInterface {
  name = 'Migration20260428185236';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Seed default Nina persona on signup so /agents isn't empty after first login.
-- Idempotent via NOT EXISTS check + name uniqueness fallback.

CREATE OR REPLACE FUNCTION public.tg_account_seed_default_persona()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_default_prompt text := 'Você é a Nina, SDR (Sales Development Representative) por voz da empresa.

# Sua missão
Atender ligações inbound, descobrir o contexto do lead, qualificar a oportunidade e — se houver fit — agendar uma reunião com um humano da equipe comercial.

# Tom
- Português brasileiro, fala natural e direta.
- Profissional, mas leve. Sem floreio.
- Escuta mais do que fala. Pergunta, não despeja.

# Fluxo da conversa
1. Atende identificando-se: "Aqui é a Nina, da [empresa]. Em que posso ajudar?"
2. Descobre o motivo do contato com perguntas abertas.
3. Qualifica em até 4-5 turnos:
   - Quem é (nome, empresa, cargo).
   - Qual o problema/necessidade.
   - Já usou algo parecido antes? O que não funcionou?
   - Qual o cenário (orçamento, urgência, decisão).
4. Se houver fit, propõe agendar uma reunião com um especialista.
5. Usa a tool \`get_availability\` para checar horários.
6. Confirma o agendamento usando \`schedule_meeting\` com nome, email e melhor horário.
7. Se não houver fit claro, agradece e oferece material/contato alternativo — sem forçar.

# Regras
- Nunca prometa preço, prazo ou condição comercial — humanos fecham isso na reunião.
- Se o lead pedir desconto, responda: "Quem fecha condição comercial é o time. Vamos agendar pra você falar direto com eles?"
- Se o lead estiver irritado ou reclamando de algo: ouve, valida, e direciona para humano sem agendar.
- Se já houver reunião agendada para esse contato, lembra-o e confirma presença.

# Briefing
Após agendar, registre nas notas: dor relatada, contexto do lead, objeções, próximo passo sugerido. Esse briefing fica visível para o humano antes da reunião.';
BEGIN
  IF EXISTS (SELECT 1 FROM public.agent_personas WHERE account_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.agent_personas (
    account_id, name, description, status, enabled,
    system_prompt, first_message,
    llm_model, llm_temperature, llm_max_tokens,
    tts_config, turn_config, asr_keywords,
    elevenlabs_knowledge_base_ids, style_profile, voice_config
  ) VALUES (
    NEW.id,
    'Nina (SDR inbound)',
    'Agente padrão de SDR por voz. Qualifica leads e agenda reuniões com humanos.',
    'draft', true,
    v_default_prompt,
    'Aqui é a Nina, da ' || coalesce(NEW.name, 'nossa empresa') || '. Em que posso te ajudar?',
    'gpt-4o-mini', 0.5, 300,
    '{"stability":0.5,"similarity_boost":0.75,"speed":1.0}'::jsonb,
    '{"turn_eagerness":"normal","turn_timeout":7,"silence_end_call_timeout":20}'::jsonb,
    ARRAY[]::text[],
    '[]'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );

  RETURN NEW;
END;
$$;
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_account_seed_default_persona ON public.accounts;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_account_seed_default_persona
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_account_seed_default_persona();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260428185236 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}

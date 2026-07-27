# Roteiro de testes E2E — Nexus

Última atualização: 2026-04-23 (pós commit `69aa2d8`).

Objetivo: validar que cada fluxo do produto funciona de ponta a ponta em
produção (Lovable Cloud) antes de abrir pra cliente real. Cada teste
deve ser reproduzível — se falhar, documenta o que quebrou e o que
esperava.

---

## Pré-requisitos

- [ ] Deploy no Lovable está no commit mais recente da branch `main`.
- [ ] Cloud Secrets setados: `ZERNIO_API_KEY`, `ELEVENLABS_API_KEY`,
      `ELEVENLABS_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
- [ ] Conta Twilio com saldo ≥ US$ 10 e ao menos 1 número ativo.
- [ ] Celular de teste verificado na Twilio (se conta ainda for trial)
      ou qualquer celular BR (se paga).
- [ ] Conta ElevenLabs com saldo de chars suficiente pra ~5 ligações.

Se algum item falhar, rode o teste **T0 — Setup** antes de seguir.

---

## T0 — Setup inicial (conta zerada)

**Contexto:** simular o que um remixer vive na primeira vez.

1. Abre o Nexus, faz login.
2. Modal de boas-vindas aparece → clica **Abrir configuração**.
3. Aba `Integrações` mostra status em tempo real:
   - [ ] Zernio: `Operando · N conta(s) conectada(s)`
   - [ ] ElevenLabs: `Operando · plano X · N% usado`
   - [ ] Twilio: `Operando · Saldo: USD X.XX`
   - [ ] Evolution: opcional, pode estar `Não configurado`
4. Se algum aparece `Não configurado`, segue a instrução do card pra
   colocar a secret.
5. Banner de readiness no topo: verde se tudo ok.

**Esperado:** dashboard reflete realidade. Cards têm link "Ir pra
configuração" funcional.

**Se falhar:** verifica que a edge function `integrations-status` está
deployada (`verify_jwt=false` no config.toml) e que cada secret bate o
nome exato.

---

## T1 — Criar e sincronizar agente

**Contexto:** configuração mínima de uma persona pra ligações.

1. Navega pra `/agents` → **Novo agente**.
2. Nome: `Nina Test`, descrição livre. Cria.
3. Modal de edição abre automaticamente na aba **Cérebro**.
4. Clica **✨ gerar com IA** → modal.
5. Descrição: _"atendente de loja de roupas especializada em pessoas
   com nanismo, tom descolado"_.
6. **Gerar** → preview do prompt aparece em ~5s.
7. **Usar esse prompt** → aplicado no textarea.
8. Na aba **Voz**: lista de vozes ElevenLabs carrega (filtro pt-BR
   ativo).
9. Clica Play em 2-3 vozes → ouve em pt-BR com o texto de teste.
10. Clica **Usar** na escolhida → badge "atual" aparece.
11. Volta em **Cérebro** → clica **Sincronizar com EL**.
12. Toast verde: `Agente ElevenLabs sincronizado — ID: agent_...`
13. Badge "sincronizado" aparece na caixa violeta.
14. **Salvar** → modal fecha, card mostra pílulas verdes "prompt",
    "voz".

**Esperado:** persona tem `elevenlabs_agent_id`, `voice_clone_id`,
`system_prompt`.

---

## T2 — Voice cloning (opcional)

**Contexto:** criar voz personalizada a partir de áudio próprio.

1. Em `/agents`, abre a persona, aba **Voz**.
2. Na caixa violeta "Clonar minha voz", clica **Escolher áudio**.
3. Seleciona um MP3/WAV com 30s-5min de você ou outra pessoa falando
   pt-BR (sem música de fundo, ambiente limpo).
4. Clica **Clonar**. Toast progresso.
5. Após ~10-30s, voz aparece na lista com badge "clone" + `Usar`
   preenche voice_clone_id da persona automaticamente.
6. Faz Play pra confirmar que soa parecido com o áudio original.
7. Volta em **Cérebro** → **Sincronizar com EL** pra atualizar o
   agent.

**Esperado:** voz criada no workspace ElevenLabs, voice_clone_id
atualizado na persona, agent ElevenLabs agora usa essa voz.

---

## T3 — Ativar IA em um número Twilio

1. `/phone-numbers` → **Importar existente**.
2. Dropdown lista números da conta Twilio (via `twilio-numbers-owned`).
3. Escolhe o número, pina a persona `Nina Test`, comportamento **IA
   atende**, importa.
4. Card do número aparece. Clica **Ativar IA**.
5. Toast: `IA ativada — inbound e outbound agora via ElevenLabs`.
6. Card ganha badge violeta **IA nativa**.
7. Botão de outbound muda de `Ligar` pra `Ligar (IA)`.

**Verificação externa:** na EL, `/v1/convai/phone-numbers` lista esse
número com `assigned_agent` correto. No Twilio Console, a Voice URL do
número foi sobrescrita pra `api.elevenlabs.io/twilio/inbound_call`.

---

## T4 — Ligação outbound (IA liga pro cliente)

1. Em `/phone-numbers`, no card do número ativado.
2. Toggle "Discagem ativa habilitada" está ON.
3. Digita teu celular no campo (E.164, ex: `+5548XXXXXXXX`).
4. Clica **Ligar (IA)**.
5. Toast: `IA ligando pra +55…`
6. Celular toca em 3-8s.
7. Atende. Nina cumprimenta com o `first_message` configurado.
8. Conversa natural em pt-BR. Testa:
   - Pergunta preço de produto → deve consultar a KB.
   - Pergunta tamanho pra quem tem 1,20m → deve usar a tabela NX.
   - Fala "quero falar com um humano" → deve tentar transferir (ou
     avisar que vai).
9. Desliga.
10. Espera 10-20s. Em `/phone-numbers`, o novo registro aparece no
    histórico. Clica → modal detalha a call.
11. Transcrição aparece (populada pelo webhook
    `elevenlabs-events`).
12. Clica **Carregar gravação** → proxy via
    `elevenlabs-call-audio` → player inline funciona → download MP3
    baixa.

**Esperado:** call completa, transcript + áudio disponíveis.

---

## T5 — Ligação inbound (cliente liga)

1. Do teu celular, liga pro número Twilio.
2. Atende instantaneamente (sem trial preamble se a conta é paga).
3. Nina abre com o first_message.
4. Mesmo roteiro de conversa do T4.
5. Desliga.
6. Em `/phone-numbers`, histórico mostra call com `direction: inbound`.

---

## T6 — Mensagem DM Instagram

**Pré:** Zernio com IG conectado, persona com auto-reply ativo.

1. Do teu Instagram pessoal, manda DM pro IG da conta (`@ghmbarboza`
   no teste).
2. Em menos de 5s a mensagem aparece em `/inbox` — nova conversa.
3. Em ~5-15s, a IA responde automaticamente (sem intervenção).
4. Confirma que resposta chegou no DM do teu Instagram.
5. Responde novamente. Ciclo repete.
6. No painel, clica **IA/Humano** no header da conversa pra parar a
   IA. Envia mensagem manual. Cliente recebe teu texto.
7. Clica novamente pra reativar IA.

**Esperado:** realtime < 10s, contato criado em `/contacts` com
`identifier: zernio:instagram:…`.

---

## T7 — WhatsApp via Evolution (opcional)

**Pré:** `/channels` → WhatsApp com URL + API key do teu servidor
Evolution.

1. Clica **Gerar QR** → QR aparece.
2. No teu celular, WhatsApp → **Dispositivos conectados** → lê o QR.
3. Status vira `connected` em 5s.
4. De outro celular, manda WhatsApp pro teu número conectado.
5. Aparece em `/inbox` em <5s.
6. IA responde. Cliente recebe.

---

## T8 — Campanha de mensagem em massa

1. `/campaigns` → Nova.
2. Canal: WhatsApp ou Instagram.
3. Seleciona 5 contatos existentes.
4. Mensagem livre (template WhatsApp NÃO necessário com Evolution).
5. Dispara.
6. Em 30s, todos os 5 contatos recebem a mensagem.
7. `/inbox` mostra 5 novas conversas (ou reativa existentes).

---

## T9 — Campanha de ligação em massa via CSV

**Pré:** persona sincronizada, número com IA ativa.

1. `/voice-campaigns` → Nova campanha.
2. Nome `Pesquisa de satisfação teste`, seleciona número + persona.
3. Modo **Conversacional** (sem script fixo).
4. Na coluna direita, aba **Subir CSV**.
5. Cola:
   ```
   nome,telefone,produto
   João,+5548XXXXXXXX,camiseta
   Maria,+5511988887777,calça
   ```
   (use teus próprios telefones verificados!)
6. Preview mostra: 2 válidos, ambos "novo" ou "reutilizar".
7. **Iniciar campanha**. Toast: `2 contatos na fila`.
8. Volta à lista, card mostra progresso em realtime.
9. Celulares tocam (até 5 em paralelo, cap default).
10. Atende um, conversa, desliga. `placed_count` vai pra 2,
    `connected_count` sobe conforme atenderem.
11. Após todos terminarem, card mostra status `completed`.

---

## T10 — Merge de contatos duplicados

1. Em `/contacts`, encontra 2 contatos que são a mesma pessoa (ex:
   Tiago via IG + Tiago via WhatsApp).
2. Marca ambos nos checkboxes.
3. Botão **Mesclar 2** aparece no header.
4. Modal abre com preview. Escolhe o "principal" (o que tem mais
   conversas).
5. Confirma merge.
6. Toast: `Contatos mesclados · N conversas + M canais movidos`.
7. Só 1 contato aparece agora. Conversas de IG e WA estão todas sob
   ele.

---

## T11 — Alertas de saldo/quota

**Setup artificial:** forçar um valor baixo.
- Opção 1: esgota o Twilio (use outra conta pra testar isso)
- Opção 2: manda Nina falar 3min seguidos pra consumir ElevenLabs
  chars

1. Após saldo baixar a <US$5 Twilio OR >85% EL, faz refresh do
   Nexus.
2. Banner âmbar aparece no topo, abaixo da topbar.
3. Link "resolver" leva pra `/settings → Integrações`.
4. Botão X fecha o banner pela sessão.

---

## Checklist de saída

Antes de liberar pra cliente real, todos esses devem passar:
- [ ] T0 setup
- [ ] T1 criar agente sincronizado
- [ ] T3 ativar IA em número
- [ ] T4 outbound individual + transcript + gravação
- [ ] T5 inbound individual
- [ ] T6 OR T7 DM messaging com auto-reply
- [ ] T9 campanha de voz com CSV ≥ 2 contatos
- [ ] T11 alertas (pelo menos visualizar o banner)

T2 (clone) e T10 (merge) são nice-to-have — podem passar depois.

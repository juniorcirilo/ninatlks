# Meta App Review — Submission Package

> Tudo que você precisa pra submeter o app **"Teste Token Trafic"** (ID `1245816313673400`) pra review e destravar DMs de Instagram em produção.

---

## Pré-requisitos (checklist antes de submeter)

- [ ] **Business Verification** concluída no Meta Business Manager
- [ ] **Privacy Policy URL** publicada: `https://<seu-domínio>/privacy`
- [ ] **Terms of Service URL** publicada: `https://<seu-domínio>/terms`
- [ ] **Data Deletion URL** publicada: `https://<seu-domínio>/data-deletion`
- [ ] **Data Deletion Callback** endpoint: `https://rjcgdesoiujrvtsjrgdy.supabase.co/functions/v1/meta-data-deletion`
- [ ] **App Icon** 1024x1024 PNG enviado em App Settings → Basic
- [ ] **App Category** definida (Business/Productivity)
- [ ] **App Name** revisada — "Teste Token Trafic" é nome interno? Troca por algo que descreva a funcionalidade pro usuário final (ex.: "Nexus Atendimento")
- [ ] **App Description** (500 chars) explicando o que o app faz
- [ ] **Secrets rotacionados** após esta conversa (META_APP_SECRET, access tokens IG)
- [ ] Pelo menos 1 Tester adicionado em App Roles pra testar antes

---

## Permissões a solicitar

| Permissão | Obrigatório? | Para quê |
|---|---|---|
| `instagram_basic` | ✅ | Ler perfil da conta IG (username, nome) |
| `instagram_manage_messages` | ✅ | Receber e enviar DMs |
| `pages_messaging` | ⚠️ só se ativar Messenger | Enviar mensagens via Messenger |
| `pages_show_list` | ⚠️ só se ativar Messenger | Listar páginas do usuário |
| `pages_manage_metadata` | ⚠️ só se ativar Messenger | Configurar webhook da página |
| `business_management` | opcional | Ler estrutura do Business Manager do cliente |

---

## Justificativas — cole exatamente no formulário do Meta

### `instagram_basic`

> O aplicativo usa `instagram_basic` para identificar a conta Instagram Business
> que o cliente conectou à nossa plataforma de atendimento ao cliente. Lemos
> apenas o username, nome de exibição e tipo de conta (BUSINESS/CREATOR) para
> validar a conexão e exibir no painel do cliente qual conta está vinculada.
> Não armazenamos mídia nem histórico público do perfil.
>
> Fluxo observável no screencast: 3. Conectar conta Instagram Business.

### `instagram_manage_messages`

> Essencial para a função core do aplicativo: receber e responder mensagens
> diretas que clientes finais enviam à conta Instagram Business do nosso
> cliente. A plataforma é uma ferramenta de atendimento ao cliente — substitui
> ou complementa o atendimento humano permitindo que empresas respondam 24/7
> com agentes de IA treinados pelo próprio cliente.
>
> Como usamos:
> 1. Recebemos webhook `messages` quando um usuário envia DM.
> 2. Enriquecemos o remetente com nome público (via `instagram_basic`).
> 3. Encaminhamos a conversa ao painel do cliente.
> 4. Se configurado, um agente de IA responde; caso contrário, um atendente
>    humano responde pelo painel.
> 5. Enviamos a resposta via endpoint `/messages` da Graph API.
>
> Jamais enviamos mensagens não solicitadas (bulk DM / cold outreach).
> Mensagens só saem em resposta a uma conversa iniciada pelo usuário ou dentro
> da janela de 24h conforme política da Meta.
>
> Fluxo observável no screencast: 5. Receber DM → 6. Painel exibe → 7. IA responde.

### `pages_messaging` (se usar Messenger)

> O aplicativo permite aos nossos clientes responderem mensagens do Messenger
> na mesma plataforma que usam para WhatsApp e Instagram. Usamos
> `pages_messaging` exclusivamente para enviar respostas a mensagens que o
> próprio usuário iniciou com a página do cliente. Não disparamos campanhas
> outbound sem opt-in.

### `pages_manage_metadata` (se usar Messenger)

> Usamos apenas para subscrever os webhooks de `messages` e `messaging_postbacks`
> na página do cliente durante o processo de conexão na tela de Ajustes → Canais.
> Não alteramos nenhum outro metadado da página.

---

## Data Deletion

### Data Deletion Request URL
Formulário público onde usuário solicita exclusão voluntária:
```
https://<seu-domínio>/data-deletion
```

### Data Deletion Callback URL
Endpoint chamado pela Meta quando usuário remove o app dele. Retorna JSON
com URL de status + código de confirmação (formato exigido pela Meta):
```
https://rjcgdesoiujrvtsjrgdy.supabase.co/functions/v1/meta-data-deletion
```

Teste do callback antes de submeter:
```bash
# Meta envia signed_request como form-data. Esse é um teste simulado
# (não vai passar a assinatura sem o App Secret real)
curl -X POST "https://rjcgdesoiujrvtsjrgdy.supabase.co/functions/v1/meta-data-deletion" \
  -F "signed_request=invalid.signed_request_test"
```
Esperado: `{"error":"invalid signed_request"}` com 400 — confirma que o endpoint está vivo e validando assinatura.

---

## Test User credentials (obrigatório pro reviewer)

Crie um **Test User** em App Roles → Test Users:
- O Meta provisiona automaticamente uma conta FB de teste conectada ao app
- Essa conta JÁ tem permissão pra testar funcionalidades mesmo em development mode

Ou use sua conta normal como Tester + credenciais de acesso ao painel Nexus:

```
Painel de teste:  https://<seu-domínio>/auth
E-mail:           reviewer@nexus.viverdeia.ai  (criar)
Senha:            <gerar senha longa, anotar>
Workspace:        pré-configurado com conta Instagram de teste conectada
```

---

## Instructions for reviewer (cola no campo "Instructions")

```
Nexus is a multi-channel customer support platform. Here's how to test
the Instagram Messaging integration:

1. Login at https://<domain>/auth with credentials provided.

2. Navigate to Canais (left sidebar → "Canais" under Análise e configuração).
   You'll see Instagram already connected to a test account.

3. Open a new private/incognito window and visit the public Instagram
   profile of the connected test account. Send a DM with any text
   (e.g., "testing app review").

4. Within ~3 seconds, the DM will appear in the Nexus Caixa de entrada
   (left sidebar → "Caixa de entrada").

5. If the pre-configured AI agent is enabled, you'll see an automated
   response appear in the conversation. Otherwise, type a reply manually
   in the conversation panel at the right.

6. Confirm the reply arrives on the original Instagram DM thread within
   ~2 seconds.

Data the app processes:
- Sender's Instagram @ and display name (via instagram_basic)
- Message content and attachments (via instagram_manage_messages)
- Conversation metadata (timestamps, read status)

Data NOT processed:
- Public posts, stories, or reels
- Followers list
- Any data about users who did not message the test account

Privacy policy: https://<domain>/privacy
Terms: https://<domain>/terms
Data deletion: https://<domain>/data-deletion
```

---

## Screencast — roteiro de ~2 min

Grava tela com narração. Pode ser Loom, Screen Recording do Mac, etc.
Meta aceita até 120s, 50MB, mp4/mov.

**Cenas obrigatórias (cada uma visível por ~10-15s):**

1. **Abertura** (0:00 – 0:10)
   - Abre `https://<domain>/auth` no navegador
   - Loga com o reviewer account
   - Fala: *"Nexus is a customer support platform. Let me show how we use Instagram Messaging."*

2. **Canal conectado** (0:10 – 0:25)
   - Vai em Ajustes → Canais
   - Mostra Instagram "Conectado" na tela
   - Fala: *"Our customer has already connected their Instagram Business account."*

3. **Inbox vazio antes do teste** (0:25 – 0:35)
   - Abre /inbox (Caixa de entrada)
   - Mostra que não há conversa nova
   - Fala: *"Empty inbox. Let's simulate a real user sending a DM."*

4. **Usuário externo envia DM** (0:35 – 0:55)
   - Em outra janela/aba: abre `instagram.com/<test_account>`
   - Tela dividida OU corta pra app Instagram mobile
   - Digita e envia DM "Hi, I'd like to know your opening hours"
   - Fala: *"As a potential customer, I send a DM to the business."*

5. **Mensagem aparece no painel** (0:55 – 1:15)
   - Volta pro Nexus — mensagem aparece na Caixa de entrada
   - Clica na conversa pra abrir
   - Mostra o conteúdo + nome do remetente
   - Fala: *"The message appears in real-time in the support dashboard."*

6. **Resposta (humana ou IA)** (1:15 – 1:40)
   - Se tem IA configurada: mostra a resposta automática aparecendo
   - Se não: digita e envia "Hi! We're open Mon-Fri 9-6."
   - Fala: *"The agent replies — either manually or via an AI agent trained by our customer."*

7. **Confirmação no Instagram** (1:40 – 2:00)
   - Volta pra janela do Instagram
   - Mostra a resposta chegando na thread original
   - Fala: *"The reply arrives instantly on the original Instagram thread. That's the full cycle."*

**Dicas:**
- Fala em inglês (Meta prefere, acelera review)
- Use cursor destacado (CleanShot, Keycastr) pra reviewer ver cliques
- Não corta muito — reviewer precisa ver o fluxo contínuo
- Mostra a URL do Nexus no topo do navegador o tempo todo pra provar que é domínio real

---

## Website URL + domínio

Meta exige um domínio publicamente acessível com as 3 páginas legais servidas. Como o Nexus roda em Lovable Cloud, você provavelmente tem um subdomínio tipo `nexus-xxx.lovable.app`. **Idealmente** configura um domínio custom:

1. No Lovable Cloud → Project → Settings → Custom Domain
2. Aponta CNAME do seu domínio
3. Aguarda SSL propagar
4. Atualiza:
   - **Meta App → Settings → Basic → App Domains**: adiciona o domínio custom
   - **Meta App → Settings → Basic → Privacy Policy URL**
   - **Meta App → Settings → Basic → Terms of Service URL**
   - **Meta App → Settings → Basic → Data Deletion → Data Deletion Callback URL**
   - **Meta App → Settings → Basic → Data Deletion → Data Deletion Request URL**

---

## Submissão — passo a passo

1. **Meta Developers → seu app `1245816313673400` → App Review → Permissions and Features**

2. Pra cada permissão listada acima, clica **"Request Advanced Access"**

3. Preenche:
   - How will you use this permission → cola a justificativa correspondente deste doc
   - Attach screencast (upload do vídeo)
   - Attach test user credentials (o Meta já tem via Test Users, mas cole no "Add Notes for Reviewer")

4. **Submit for Review** no final da página

5. **Aguarde 3-7 dias úteis**. Meta responde por e-mail.

---

## Se for rejeitado

Não é fim de mundo — 80% dos apps são rejeitados na 1ª tentativa. Meta manda motivo específico:
- "Screencast doesn't show X" → regrava mostrando explicitamente
- "Missing data deletion callback" → confirma que a URL está respondendo
- "Privacy policy insufficient" → edita `/src/routes/privacy.tsx` expandindo a seção sobre Meta data

Você edita, resubmete. Reset do timer, mais 3-7 dias.

---

## Depois do Live Mode

Quando Meta aprovar e você mover app para **Live Mode**:
- Qualquer usuário do Instagram pode mandar DM → webhook dispara
- Você pode vender o Nexus pra clientes finais conectarem suas próprias contas IG
- Rate limits aumentam (Meta tem buckets por app)
- Aparece no histórico do usuário em "Apps and Websites"

---

## Contatos úteis

- [Instagram Platform Policy](https://developers.facebook.com/docs/instagram-platform/policy)
- [Messaging Permission Guide](https://developers.facebook.com/docs/messenger-platform/instagram/overview)
- [App Review Best Practices](https://developers.facebook.com/docs/app-review)
- [Data Deletion Callback Docs](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)

# n8n-nodes-utalks

Nó da comunidade n8n para o utalks.

- **utalks** — 163 operações em 22 recursos (contatos, listas, ligações, campanhas, agentes, reuniões, mensagens, cadências, pipeline, telefonia, ElevenLabs, WhatsApp, webhooks…) mais **Requisição personalizada** para qualquer rota sob `/accounts/{conta}`.
- **utalks Trigger** — dispara o workflow nos eventos do utalks, com **seleção múltipla**: `call.finished`, `call.transferred`, `meeting.scheduled`, `meeting.rescheduled`, `campaign.finished`, `contact.disposition_changed`.

## 1. Servidor (utalks)

O node usa uma chave global. Defina no `.env` do servidor e reinicie:

```
N8N_NODE_API_KEY=<mínimo 32 caracteres aleatórios>   # ex.: openssl rand -hex 32
N8N_NODE_USER_ID=<id de um usuário admin>             # a chave age como esse usuário
```

- A chave age como `N8N_NODE_USER_ID`: só alcança contas em que ele é membro, com o papel dele. O Trigger cria destinos de webhook, que exigem papel **admin**.
- Sem as duas variáveis, a chave fica desligada.
- A chave **não** acessa `/auth`, `/accounts/:id/secrets`, `/api-keys`, `/members` e `/invites`.

## 2. Credencial no n8n

| Campo | Valor |
|---|---|
| URL do utalks | `https://utalks.ubva.com.br` (ou `http://utalks:3001` na rede Docker) |
| Chave do node | o valor de `N8N_NODE_API_KEY` |
| ID da conta | UUID da conta |

## 3. Usar

- **utalks**: escolha Recurso → Operação. Parâmetros de caminho viram campos; filtros vão em *Parâmetros de consulta*; o corpo em *Corpo (JSON)*. Listas viram um item por elemento (desligue em *Opções*).
- **utalks Trigger**: escolha os eventos. Ao ativar o workflow o node cria o destino no utalks e guarda o segredo; ao desativar, remove. Cada entrega tem a assinatura `X-Nina-Signature` verificada (HMAC-SHA256 de `<timestamp>.<corpo>`, tolerância de 5 min). Teste e produção usam destinos separados.

## Instalar

```
npm install && npm run build
```

Copie/aponte a pasta para `~/.n8n/custom` (ou `N8N_CUSTOM_EXTENSIONS`) e reinicie o n8n; ou publique o pacote e instale em *Configurações → Nós da comunidade*.

## Manutenção

`nodes/Utalks/operations.ts` é gerado de `scripts/routes.txt` (rotas dos controllers do servidor): `npm run gen`. O que fica fora do node: onboarding, anexos, segredos, chaves de API, equipe/convites, OAuth do Google e rotas do próprio n8n.

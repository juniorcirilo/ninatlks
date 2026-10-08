# Integração ERP → n8n → Utalks

Carga de listas operacionais vindas de um sistema externo (SQL Server do ERP)
para as campanhas de voz: prospecção, orçamento não concluído e cobrança de
títulos pendentes.

Funciona igual em **n8n auto-hospedado** e **n8n Cloud** — a única diferença
está na URL que cada um alcança e na allowlist de IP (ver
[Auto-hospedado vs Cloud](#auto-hospedado-vs-cloud)).

---

## 1. Gerar a chave de API

Só admin da conta. A chave aparece **uma vez** — o banco guarda apenas o
SHA-256 dela, não há como reexibi-la depois.

```bash
curl -X POST https://utalks.ubva.com.br/accounts/<ACCOUNT_ID>/api-keys \
  -H 'Content-Type: application/json' \
  -H 'Cookie: sid=<sessão de admin>' \
  -d '{"name": "n8n produção"}'
```

```json
{ "id": "…", "token": "ntk_a1b2c3d4_xY9…", "tokenPrefix": "a1b2c3d4" }
```

Guarde `token` numa credencial do tipo *Header Auth* no n8n. Revogar:
`DELETE /accounts/<ACCOUNT_ID>/api-keys/<id>` — a linha continua existindo com
`last_used_at` e `last_used_ip`, que é o que responde "essa chave chegou a ser
usada, e de onde?".

Campos opcionais na criação:

| Campo | Para quê |
|---|---|
| `ipAllowlist` | Trava a chave em IPs de saída. Use em n8n auto-hospedado; **não** use em Cloud. |
| `expiresAt` | Validade (ISO 8601). Sem isso a chave não expira. |

---

## 2. Enviar a lista operacional

`POST /ingest/operational-list`, autenticada por `Authorization: Bearer ntk_…`.
Repare que **não há `accountId` na URL**: a conta sai da própria chave, então
uma credencial mal configurada no n8n não tem como escrever em conta alheia.

```http
POST https://utalks.ubva.com.br/ingest/operational-list
Authorization: Bearer ntk_a1b2c3d4_xY9…
Content-Type: application/json

{
  "listKey": "cobranca-vencidos-30d",
  "listName": "Cobrança — vencidos há 30 dias",
  "campaignKind": "cobranca",
  "replaceMembers": true,
  "rows": [
    {
      "externalId": "TIT-40312",
      "name": "Maria Souza",
      "phone": "11987654321",
      "email": "maria@exemplo.com.br",
      "variables": {
        "valor_titulo": "1.240,00",
        "vencimento": "12/06/2026",
        "numero_titulo": "40312",
        "dias_atraso": "47"
      }
    }
  ]
}
```

Resposta:

```json
{
  "listId": "…", "listKey": "cobranca-vencidos-30d",
  "created": 1, "updated": 0, "skipped": 0, "removed": 12,
  "memberCount": 340, "invalidPhones": []
}
```

### O que cada campo faz

| Campo | Comportamento |
|---|---|
| `listKey` | Chave estável da lista. **A carga é idempotente por ela**: rodar o workflow de novo atualiza a mesma lista, nunca cria outra. |
| `campaignKind` | `sdr`, `cobranca`, `pos_venda`, `retencao` ou `custom`. Define o catálogo de desfechos que a agente usa para classificar a ligação. |
| `replaceMembers` | `true` = quem não veio nesta carga **sai da lista** (título pago no ERP para de ser ligado). O contato em si nunca é apagado, só deixa de ser membro. |
| `externalId` | Chave do registro no ERP. É por ela que o upsert casa, e é ela que volta no relatório de desfechos. |
| `phone` | Aceita `11987654321`, `(11) 98765-4321` ou `+5511987654321` — a normalização para E.164 assume Brasil em números de 10/11 dígitos. Linha sem telefone válido entra em `skipped`. |
| `variables` | **O conteúdo da operação.** Chega na fala da agente como variável dinâmica: `{{valor_titulo}}`, `{{vencimento}}`, `{{numero_titulo}}`. Use exatamente estes nomes no prompt da persona. |

### Deduplicação

O upsert casa nesta ordem: `external_id` → `identifier` (e-mail, ou telefone) →
insere novo. O passo do meio importa: base que já estava no produto (importada
por CSV, por exemplo) é reaproveitada em vez de virar contato duplicado na
primeira carga do ERP.

`external_id` só é **preenchido**, nunca reescrito — se o contato já tem dono no
ERP, uma carga com chave diferente não o sequestra.

Contato apagado por retenção/LGPD sai como `skipped` e não é ressuscitado pela
carga.

### Volume

Máximo de **5.000 linhas por requisição** (o upsert roda linha a linha dentro de
uma transação só). Base maior deve ser paginada pelo n8n — e aí `replaceMembers`
só pode vir na **última página**, senão cada página apaga o que a anterior
inseriu.

---

## 3. Criar a campanha

A carga cria a *lista*, não a campanha. A campanha é criada na tela
(`/campanhas/nova`), escolhendo a lista, a persona, o número de saída e a
janela de discagem. Isso é deliberado: campanha é decisão de operação, com
custo por minuto e implicação de compliance — não deve nascer de um cron do
ERP sem alguém olhando.

Na tela, a lista sincronizada aparece com o selo **sincronizada** e com a
contagem de variáveis que os contatos trazem. No passo do script, essas
variáveis viram botões clicáveis que inserem `{{valor_titulo}}`,
`{{vencimento}}` etc. na abertura — é assim que quem monta a campanha descobre
quais dados aquela carga trouxe.

Ao criar a campanha a partir da lista, as `variables` de cada contato viajam
junto e chegam à ElevenLabs como `dynamic_variables`.

Editar na mão uma lista sincronizada funciona, mas a próxima carga com
`replaceMembers: true` desfaz a edição. A tela avisa isso ao abrir a edição.

### Campanha fechada ou campanha viva

No passo da lista, campanha criada sobre lista sincronizada escolhe o que fazer
quando chegar uma carga nova:

| Modo | Comportamento |
|---|---|
| **Nada — campanha fechada** (padrão) | Os contatos são congelados na criação. Cargas seguintes mudam a lista, não a campanha. Serve para uma onda pontual. |
| **Oferecer em lote, com aprovação** | A campanha acompanha a lista. Cada carga junta os contatos novos num **lote pendente**, e nada disca antes de alguém aprovar na tela da campanha. |

O segundo modo é o que serve para cobrança: a carteira é recalculada todo dia,
e criar campanha nova a cada manhã perderia histórico e funil.

A trava é estrutural, não uma convenção: o contato pendente entra com status
`pending_approval`, e o discador só olha `queued`. Não existe caminho em que
uma carga do ERP disque sozinha — nem por erro de configuração, nem por um
filtro que alguém remova sem perceber.

Na tela da campanha, cada lote pendente mostra quantos contatos traz, de que
carga veio, e abre uma amostra com nome, código do ERP, telefone e as variáveis
com que a agente vai ligar. Dois botões: **Aprovar e discar** ou **Descartar**.

- **Aprovar** move o lote para a fila. Se a campanha já tinha zerado a carteira
  anterior e estava concluída, ela reabre.
- **Descartar** remove aquelas linhas da campanha. O contato continua na base e
  na lista, e volta a ser oferecido na próxima carga — a rejeição valeu para a
  carteira daquele dia. Para parar de ligar para alguém em definitivo, use a
  **DNC**, que vale para todas as campanhas.

A resposta da carga traz os lotes criados, para o n8n avisar o operador:

```json
{
  "listId": "…", "created": 12, "updated": 328, "removed": 40,
  "pendingBatches": [
    { "campaignId": "…", "campaignName": "Cobrança — carteira diária",
      "batchId": "…", "contactCount": 12 }
  ]
}
```

Vale ligar um nó de notificação no n8n em cima de `pendingBatches`: sem isso o
lote fica esperando até alguém abrir a tela por acaso.

---

## 4. Buscar os desfechos de volta

`GET /ingest/operational-list/<listKey>/outcomes?since=<ISO 8601>`

```json
[
  {
    "externalId": "TIT-40312",
    "phone": "+5511987654321",
    "status": "completed",
    "disposition": "atendida",
    "attempts": 1,
    "finishedAt": "2026-07-29T14:22:10.000Z",
    "outcomeCategory": "prometeu_pagar",
    "outcomeSummary": "Cliente confirmou pagamento via PIX até sexta.",
    "durationSec": 96,
    "campaignId": "…",
    "campaignName": "Cobrança — vencidos 30d"
  }
]
```

`since` puxa só o que mudou desde a última execução — é o que torna o pull
barato num Schedule Trigger de 15 em 15 minutos.

Dois níveis de resultado, e os dois importam:

- `disposition` — o desfecho **telefônico** (`atendida`, `caixa_postal`,
  `nao_atendeu`, `recusada`, `falha_operadora`, `nao_completou`, `cancelada`);
- `outcomeCategory` — o desfecho **de negócio**, classificado por IA a partir da
  transcrição, dentro do catálogo da vertical. Em cobrança:
  `prometeu_pagar`, `quitou`, `negociou_parcelas`, `pediu_boleto`,
  `contestou_divida`, `sem_condicoes`, `recusou_pagar`, `wrong_number`.

Só existe `outcomeCategory` em ligação atendida — sem conversa não há
transcrição para classificar.

---

## Auto-hospedado vs Cloud

|  | Auto-hospedado | Cloud |
|---|---|---|
| URL da API | `https://utalks.ubva.com.br` ou, se o n8n estiver na mesma rede Docker (`srv_default`), `http://utalks:3001` — evita a volta pelo nginx | `https://utalks.ubva.com.br` (precisa ser pública) |
| `ipAllowlist` | Recomendado: trave no IP de saída do servidor | **Não use.** As faixas de saída da n8n mudam sem aviso e a integração cairia numa manhã qualquer |
| Acesso ao SQL Server | Direto, se o ERP estiver na mesma rede | Precisa de túnel/VPN ou de o SQL Server estar exposto |
| Credencial | *Header Auth*: `Authorization` = `Bearer ntk_…` | idem |

Neste servidor já existe um n8n auto-hospedado (container `n8n`, porta 5678).
Como ele está na mesma máquina, o caminho curto `http://utalks:3001` funciona e
dispensa TLS na chamada interna — desde que os dois containers compartilhem a
rede `srv_default`.

## Desenho do workflow no n8n

```
Schedule Trigger (ex.: 6h)
  → Microsoft SQL (SELECT dos títulos vencidos)
  → Code (monta rows[] com externalId, phone, variables)
  → HTTP Request  POST /ingest/operational-list
  → (opcional) IF skipped > 0 → notifica o operador

Schedule Trigger (ex.: 15min)
  → HTTP Request  GET /ingest/operational-list/<key>/outcomes?since=…
  → Microsoft SQL (UPDATE do resultado no ERP, casando por externalId)
```

Um detalhe que evita retrabalho: guarde o `finishedAt` mais recente que você já
processou e mande-o como `since` na execução seguinte, em vez de reprocessar a
lista inteira.

## Erros

| Status | Significado |
|---|---|
| 401 | Chave ausente, inválida, revogada ou expirada |
| 403 | IP fora da allowlist, ou chave sem o escopo `ingest` |
| 400 | Payload inválido — inclui o caso "nenhuma linha trouxe telefone válido", que quase sempre é coluna errada no mapeamento do n8n |

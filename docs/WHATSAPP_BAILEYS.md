# WhatsApp direto (Baileys)

O utalks conversa com o WhatsApp **direto pela API Nest**, usando
[`@itsliaaa/baileys`](https://www.npmjs.com/package/@itsliaaa/baileys). Não há
Evolution API, servidor externo nem webhook: os eventos chegam do WebSocket do
WhatsApp para dentro do processo e seguem para o mesmo pipeline de mensagens
(`InboundMessageService` e funções SQL de ingestão).

## Instâncias (multi-sessão)

Uma sessão por **canal** (`channels.id`, tipo `whatsapp`), várias por conta.
Dados em disco, por sessão:

```
/data/sessions/<channelId>/
  auth/       creds.json (+ .bak) e chaves Signal — escrita atômica
  storage/    contacts.json, groups.json, lid-map.json (cache de diretório)
  meta.json
```

- Pasta raiz: `WA_SESSIONS_DIR` (padrão `/data/sessions`). No Docker ela é um
  **bind mount** (`docker-compose.yml`); sem ele, cada deploy exigiria novo QR.
- **Uma única réplica da API**: os sockets vivem no processo.
- Boot: `SessionManagerService` reconecta sozinho toda sessão já pareada
  (existe `auth/creds.json`). Sessões sem pareamento esperam o usuário pedir o QR.
- Desligar a API **não** desvincula o aparelho (usa `sock.end()`, nunca `logout()`).

## Fluxo

| Parte | Onde |
|---|---|
| Sessões, reconexão, QR, pareamento | `server/src/modules/whatsapp/session-manager.service.ts` |
| Auth state atômico | `.../whatsapp/auth-state.ts` |
| Cache de contatos/grupos/LID | `.../whatsapp/wa-store.ts` |
| Envio (texto, mídia, interativas, presença) | `.../whatsapp/wa-send.service.ts` |
| Eventos do socket → mensagens | `server/src/modules/webhooks/wa-events.service.ts` |
| API REST de canais | `.../whatsapp/whatsapp.controller.ts` (`/accounts/:id/whatsapp`) |

Estado e QR chegam ao navegador em tempo real (evento `wa_session` do socket.io).

## Operação

- **Reconexão:** backoff exponencial (3 s → 5 min). Não reconecta quando o
  aparelho desvincula (401), a sessão é substituída (440) ou a conta é
  restrita (403): nesses casos a UI mostra "Desconectada" e é preciso novo QR.
- **LID:** o telefone vem de `key.remoteJidAlt`, do mapa aprendido
  (`lid-mapping.update`) ou de `signalRepository.lidMapping`. O identificador do
  contato continua `evolution:whatsapp:<número>` (nome legado, preservado para
  não quebrar dados existentes).
- **Migração do Evolution:** as credenciais antigas não são aproveitadas;
  cada canal precisa ser pareado de novo (QR). O histórico no banco é mantido.
- **Aviso:** é o protocolo **não oficial** do WhatsApp Web; há risco de
  restrição da conta. Evite envio em massa por esse canal.

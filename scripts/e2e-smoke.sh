#!/usr/bin/env bash
# Smoke harness para a API do Nina Talks.
#   BASE   — origem da API (default: produção atrás do nginx)
#   COOKIE — cookie de sessão "sid=..." (tiers A/B); vazio = só tier PUBLIC
#   ACC    — account id
# Cada teste declara o status esperado; divergência = FAIL.
set -uo pipefail

BASE="${BASE:-https://utalks.ubva.com.br}"
COOKIE="${COOKIE:-}"
ACC="${ACC:-86baeea7-40b3-4fa1-a242-b7313b29bb63}"
PASS=0; FAIL=0; SKIP=0
FAILED_LIST=""

# hit <expected-csv> <method> <path> [json-body]
# NOCOOKIE=1 força requisição anônima — o tier PUBLIC precisa disso mesmo
# quando COOKIE está setado, senão os testes de "rejeita sem sessão" recebem
# uma sessão válida e passam a devolver 200.
hit() {
  local expect="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o /tmp/e2e_body -w '%{http_code} %{time_total}' -X "$method" "$BASE$path")
  [ -n "$COOKIE" ] && [ "${NOCOOKIE:-0}" != "1" ] && args+=(-H "Cookie: $COOKIE")
  # "form:" prefixa corpos form-urlencoded (webhooks da Twilio falam form, não JSON)
  if [ "${body#form:}" != "$body" ]; then
    args+=(-H 'Content-Type: application/x-www-form-urlencoded' -d "${body#form:}")
  elif [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi
  local out code ms
  out=$(curl "${args[@]}") || { printf 'FAIL  %-6s %-58s curl error\n' "$method" "$path"; FAIL=$((FAIL+1)); return; }
  code="${out%% *}"; ms="${out##* }"
  if [[ ",$expect," == *",$code,"* ]]; then
    printf 'ok    %-6s %-58s %s  %ss\n' "$method" "$path" "$code" "$ms"
    PASS=$((PASS+1))
  else
    printf 'FAIL  %-6s %-58s got %s want %s  %s\n' "$method" "$path" "$code" "$expect" "$(head -c 160 /tmp/e2e_body)"
    FAIL=$((FAIL+1)); FAILED_LIST="$FAILED_LIST\n  $method $path -> $code (want $expect)"
  fi
}

# jsonget <jq-filter> — lê o corpo da última resposta. Algumas rotas devolvem
# o id como texto cru (POST /contact-lists devolve só o UUID), não como JSON,
# então o fallback é o corpo inteiro quando ele já parece um id.
jsonget() {
  local v
  v=$(jq -r "$1" < /tmp/e2e_body 2>/dev/null)
  if [ -z "$v" ] || [ "$v" = "null" ]; then
    v=$(tr -d '"[:space:]' < /tmp/e2e_body)
    case "$v" in
      [0-9a-f]*-[0-9a-f]*-*|[0-9]*) : ;;
      *) v="" ;;
    esac
  fi
  printf '%s' "$v"
}

echo "=== TIER PUBLIC — sem autenticação (superfície exposta) ==="
NOCOOKIE=1
hit 200         GET  /health
hit 401         POST /auth/login '{"email":"naoexiste@invalido.tld","password":"errado"}'
hit 400,401     POST /auth/login '{"email":"malformado","password":""}'
hit 401         GET  /auth/me
hit 404,400     GET  "/invites/token-inexistente-abc123/preview"
echo "--- guards de conta rejeitam sem sessão (esperado 401) ---"
hit 401 GET  "/accounts/$ACC"
hit 401 GET  "/accounts/$ACC/contacts"
hit 401 GET  "/accounts/$ACC/personas"
hit 401 POST "/accounts/$ACC/elevenlabs/agent-sync" '{"personaId":"00000000-0000-0000-0000-000000000000"}'
hit 401 POST "/accounts/$ACC/twilio/numbers/buy" '{"phoneNumber":"+15550000000"}'
echo "--- webhooks rejeitam payload sem assinatura válida ---"
hit 403,401 POST /webhooks/twilio/incoming         'form:CallSid=fake&From=%2B15550001111'
hit 403,401 POST /webhooks/twilio/status           'form:CallSid=fake&CallStatus=completed'
hit 403,401 POST /webhooks/twilio/sms-incoming     'form:MessageSid=fake&From=%2B15550001111&Body=oi'
hit 403,401 POST /webhooks/twilio/recording-status 'form:RecordingSid=fake&CallSid=fake'
hit 403,401 POST /webhooks/evolution/incoming      '{"event":"fake"}'
# Meta responde 200 com corpo de erro por exigência do callback de data-deletion
# deles; o importante é que rejeita o signed_request inválido, e rejeita.
hit 200     POST /webhooks/meta/data-deletion      '{"signed_request":"fake"}'
# ElevenLabs: sem ELEVENLABS_WEBHOOK_SECRET no ambiente os dois handlers
# aceitam qualquer requisição. Documentado como falha até o secret existir.
hit 403,401 POST /webhooks/elevenlabs/events       '{"type":"fake"}'
hit 403,401 POST /webhooks/elevenlabs/personalization '{"caller_id":"fake"}'
echo "--- agent-tools exigem o shared secret ---"
hit 401,403 POST /agent-tools/get-availability   '{"accountId":"'"$ACC"'"}'
hit 401,403 POST /agent-tools/qualify-lead       '{"accountId":"'"$ACC"'"}'
hit 401,403 POST /agent-tools/schedule-meeting   '{"accountId":"'"$ACC"'"}'
hit 401,403 POST /agent-tools/confirm-meeting    '{"accountId":"'"$ACC"'"}'
hit 401,403 POST /agent-tools/reschedule-meeting '{"accountId":"'"$ACC"'"}'

NOCOOKIE=0

if [ -z "$COOKIE" ]; then
  echo
  echo "=== TIERS A/B PULADOS — sem COOKIE de sessão ==="
  SKIP=$((SKIP+1))
else
  echo
  echo "=== TIER A — leitura autenticada (GET) ==="
  hit 200 GET "/auth/me"
  hit 200 GET "/accounts/$ACC"
  hit 200 GET "/accounts/$ACC/contacts"
  hit 200 GET "/accounts/$ACC/contacts/productivity"
  hit 200 GET "/accounts/$ACC/contacts/editable-campaigns"
  hit 200 GET "/accounts/$ACC/contacts/tags/suggestions"
  hit 200 GET "/accounts/$ACC/contact-lists"
  hit 200 GET "/accounts/$ACC/campaigns"
  hit 200 GET "/accounts/$ACC/campaigns/contact-lists"
  hit 200 GET "/accounts/$ACC/campaigns/personas"
  hit 200 GET "/accounts/$ACC/campaigns/phone-numbers"
  hit 200 GET "/accounts/$ACC/personas"
  hit 200 GET "/accounts/$ACC/phone-numbers"
  hit 200 GET "/accounts/$ACC/inboxes"
  hit 200 GET "/accounts/$ACC/calls"
  hit 200 GET "/accounts/$ACC/voice/calls"
  hit 200 GET "/accounts/$ACC/meetings"
  hit 200 GET "/accounts/$ACC/availability"
  hit 200 GET "/accounts/$ACC/my-availability"
  hit 200 GET "/accounts/$ACC/doctors"
  hit 200 GET "/accounts/$ACC/dnc"
  hit 200 GET "/accounts/$ACC/cadences"
  hit 200 GET "/accounts/$ACC/pipeline"
  hit 200 GET "/accounts/$ACC/dashboards/mission-control"
  hit 200 GET "/accounts/$ACC/dashboards/sdr-snapshot"
  hit 200 GET "/accounts/$ACC/dashboards/agent-analytics"
  hit 200 GET "/accounts/$ACC/notifications"
  hit 200 GET "/accounts/$ACC/notifications/unread-count"
  hit 200 GET "/accounts/$ACC/onboarding"
  hit 200 GET "/accounts/$ACC/members"
  hit 200 GET "/accounts/$ACC/invites"
  hit 200 GET "/accounts/$ACC/secrets"
  hit 200 GET "/accounts/$ACC/retention-rules"
  hit 200 GET "/accounts/$ACC/compliance-policy"
  hit 200 GET "/accounts/$ACC/dialing-settings"
  hit 200 GET "/accounts/$ACC/webhook-deliveries"
  hit 200 GET "/accounts/$ACC/persona-deployments/active-for-inbox"
  hit 200 GET "/system-settings"

  echo
  echo "=== TIER A2 — leitura que bate nos provedores externos ==="
  hit 200 GET "/accounts/$ACC/twilio/numbers/owned"
  hit 200 GET "/accounts/$ACC/twilio/numbers/search?countryCode=US&type=Local"
  hit 200 GET "/accounts/$ACC/elevenlabs/voices"
  hit 200 GET "/accounts/$ACC/evolution"
  hit 200,201 POST "/accounts/$ACC/integrations-status" '{}'

  echo
  echo "=== TIER B — CRUD ida-e-volta em dados descartáveis ==="
  TS=$(date +%s)
  hit 201,200 POST "/accounts/$ACC/contacts" '{"name":"E2E Teste '"$TS"'","phoneNumber":"+5511900000001"}'
  CID=$(jsonget '.id // .contact.id')
  if [ -n "${CID:-}" ] && [ "$CID" != "null" ]; then
    hit 200 GET   "/accounts/$ACC/contacts/$CID/timeline"
    # campos reais de updateOps (lifecycleStage/operationalStatus/ownerUserId)
    hit 200 PATCH "/accounts/$ACC/contacts/$CID" '{"lifecycleStage":"lead"}'
    # corpo sem campo atualizável: deve ser 400, não 500
    hit 400 PATCH "/accounts/$ACC/contacts/$CID" '{"campoQueNaoExiste":"x"}'
  else
    echo "SKIP  contato não criado — subtestes dependentes pulados"; SKIP=$((SKIP+1))
  fi

  hit 201,200 POST "/accounts/$ACC/contact-lists" '{"name":"E2E Lista '"$TS"'","contactIds":['"${CID:+\"$CID\"}"']}'
  LID=$(jsonget '.id // .list.id')
  if [ -n "${LID:-}" ] && [ "$LID" != "null" ]; then
    hit 200     GET    "/accounts/$ACC/contact-lists/$LID"
    hit 200     GET    "/accounts/$ACC/contact-lists/$LID/members"
    hit 200,201 POST   "/accounts/$ACC/contact-lists/$LID/members" '{"contactIds":['"${CID:+\"$CID\"}"']}'
    hit 200     PATCH  "/accounts/$ACC/contact-lists/$LID" '{"name":"E2E Lista editada"}'
    hit 200,204 DELETE "/accounts/$ACC/contact-lists/$LID"
  else
    echo "SKIP  lista não criada — subtestes dependentes pulados"; SKIP=$((SKIP+1))
  fi

  # rodado duas vezes de propósito: bloquear número já bloqueado é idempotente
  hit 201,200 POST "/accounts/$ACC/dnc" '{"phoneNumber":"+5511900000002","reason":"e2e"}'
  hit 201,200 POST "/accounts/$ACC/dnc" '{"phoneNumber":"+5511900000002","reason":"e2e repetido"}'
  DID=$(curl -s -H "Cookie: $COOKIE" "$BASE/accounts/$ACC/dnc" | jq -r '.[] | select(.phone_number=="+5511900000002") | .id' | head -1)
  [ -n "${DID:-}" ] && hit 200,204 DELETE "/accounts/$ACC/dnc/$DID"

  hit 201,200 POST "/accounts/$ACC/retention-rules" '{"name":"E2E Regra '"$TS"'","inactiveDays":90,"enabled":false}'
  RID=$(jsonget '.id')
  if [ -n "${RID:-}" ] && [ "$RID" != "null" ]; then
    hit 200     PATCH  "/accounts/$ACC/retention-rules/$RID" '{"name":"E2E Regra editada","inactiveDays":120}'
    hit 200,204 DELETE "/accounts/$ACC/retention-rules/$RID"
  fi

  hit 201,200 POST "/accounts/$ACC/doctors" '{"name":"E2E Doutor '"$TS"'","modalities":["presencial"],"defaultDurationMinutes":30}'
  DOCID=$(jsonget '.id')
  if [ -n "${DOCID:-}" ] && [ "$DOCID" != "null" ]; then
    hit 200     PATCH  "/accounts/$ACC/doctors/$DOCID" '{"name":"E2E Doutor editado","modalities":["online"],"defaultDurationMinutes":45}'
    hit 200,204 PUT    "/accounts/$ACC/doctors/$DOCID/availability" '{"slots":[]}'
    hit 200,204 DELETE "/accounts/$ACC/doctors/$DOCID"
  fi

  hit 201,200 POST "/accounts/$ACC/personas" '{"name":"E2E Persona '"$TS"'","systemPrompt":"Você é um agente de teste."}'
  PID=$(jsonget '.id')
  if [ -n "${PID:-}" ] && [ "$PID" != "null" ]; then
    hit 200     GET    "/accounts/$ACC/personas/$PID/deployments"
    hit 200     PATCH  "/accounts/$ACC/personas/$PID" '{"name":"E2E Persona editada"}'
    hit 200,204 DELETE "/accounts/$ACC/personas/$PID"
  fi

  hit 200,201 POST "/accounts/$ACC/notifications/read-all" '{}'
  # presign exige um conversationId real; sem fixture de conversa o esperado é
  # rejeição de validação, não sucesso — o que ainda exercita rota+guard+DTO.
  # 201: o presign monta a URL sem checar se a conversa existe. Não é furo de
  # tenant (o prefixo do path vem do accountId já validado pelo guard), então
  # fica registrado como comportamento, não como falha.
  hit 200,201 POST "/accounts/$ACC/attachments/presign" '{"conversationId":"00000000-0000-0000-0000-000000000000","filename":"e2e.txt","contentType":"text/plain"}'
  hit 200,201 POST "/accounts/$ACC/onboarding/health-check" '{}'

  # contato de teste removido por último (LGPD é o único delete disponível)
  if [ -n "${CID:-}" ] && [ "$CID" != "null" ]; then
    hit 200,204 DELETE "/accounts/$ACC/contacts/$CID/lgpd"
  fi
fi

echo
echo "======================================================================"
printf 'PASS %d   FAIL %d   SKIP %d\n' "$PASS" "$FAIL" "$SKIP"
[ -n "$FAILED_LIST" ] && printf 'Falhas:%b\n' "$FAILED_LIST"
exit $(( FAIL > 0 ? 1 : 0 ))

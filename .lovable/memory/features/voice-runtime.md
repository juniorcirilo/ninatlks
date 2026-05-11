---
name: voice-runtime
description: Phone numbers + voice calls schema, Twilio webhooks, voice clone gated por feature flag, página /phone-numbers
type: feature
---

# Voice Runtime — Fase 1 (Lovable)

## Schema
- `phone_numbers`: e164 unique, inbox_id, pinned_persona_id, inbound_behavior (ai_answer|suggest|forward_to_agent|voicemail), outbound_enabled, provider_config jsonb (forward_to)
- `voice_calls`: direction, status enum, provider_call_sid, transcript jsonb, recording_url, duration_seconds, total_cost_cents
- RLS: select=member, insert/update/delete=admin (phone_numbers); member em voice_calls
- Enums: phone_inbound_behavior, voice_call_direction, voice_call_status

## Edge functions
- `twilio-incoming` (verify_jwt=false): recebe webhook Twilio, busca phone_number por e164, cria voice_calls row, retorna TwiML conforme inbound_behavior. Usa `VOICE_WS_HOST` env var quando configurado, fallback voicemail
- `twilio-status` (verify_jwt=false): atualiza voice_calls.status pelo CallStatus do Twilio
- `voice-outbound`: cria voice_calls + chama Twilio /Calls.json (Basic auth), grava status=failed/reason=twilio_not_configured se secrets ausentes
- `voice-clone`: gated por accounts.feature_flags.voice_clone_enabled + role admin, multipart pra ElevenLabs /v1/voices/add, atualiza agent_personas.voice_clone_id

## Frontend
- `/phone-numbers`: lista com edição inline (inbox/persona/behavior selects, switch outbound, discador inline E.164)
- VoiceCloneDialog: drop zone audio/*, base64 chunked encoding (evita stack overflow)
- TwilioInstructionsBox: copia URLs de webhook
- Sidebar de chamadas recentes auto-poll 10s

## Fase 2 (futuro, fora do Lovable)
- Voice runtime Node.js em Fly.io/Railway com Twilio Media Streams WebSocket + Deepgram + ElevenLabs streaming
- Set `VOICE_WS_HOST=meu-host.fly.dev` como secret pro twilio-incoming responder com `<Connect><Stream>` ao invés de voicemail
- Latência alvo: <800ms turn-to-turn com barge-in

## Secrets necessários (opcionais hoje)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — sem isso, dialer retorna failed/twilio_not_configured
- `ELEVENLABS_API_KEY` — sem isso, voice-clone retorna 503
- `VOICE_WS_HOST` — sem isso, twilio-incoming devolve voicemail TwiML

## Feature flag
`accounts.feature_flags.voice_clone_enabled = true` libera UI e endpoint de clone (admin-only).

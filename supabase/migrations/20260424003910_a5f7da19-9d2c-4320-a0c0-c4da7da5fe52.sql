-- Limpa phone_numbers gerados a partir de JIDs @lid (não são telefones reais).
-- Filtra por identifier LIKE 'evolution:whatsapp:%' pra não tocar contatos
-- de outros canais (Instagram, Telegram, SMS, etc.).
UPDATE contacts
SET phone_number = NULL,
    updated_at = now()
WHERE identifier LIKE 'evolution:whatsapp:%'
  AND (
    custom_attributes->>'evolution_remote_jid' LIKE '%@lid'
    OR custom_attributes->>'evolution_lid_only' = 'true'
    OR (phone_number IS NOT NULL AND length(regexp_replace(phone_number, '\D', '', 'g')) > 13)
  );
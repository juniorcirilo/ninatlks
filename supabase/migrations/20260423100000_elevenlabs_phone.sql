-- Mirror ElevenLabs phone_number_id on our phone_numbers table.
-- Flow: /phone-numbers import → register at EL → EL reconfigures the
-- Twilio Voice webhook to their endpoint → we store the EL phone id so
-- outbound calls can use POST /v1/convai/twilio/outbound-call.
alter table public.phone_numbers
  add column if not exists elevenlabs_phone_number_id text;

comment on column public.phone_numbers.elevenlabs_phone_number_id is
  'ElevenLabs convai phone number id (phnum_…). When set, inbound calls hit api.elevenlabs.io/twilio/inbound_call instead of our twilio-incoming; outbound can use POST /v1/convai/twilio/outbound-call with this id.';

create index if not exists idx_phone_numbers_el_phone
  on public.phone_numbers(elevenlabs_phone_number_id)
  where elevenlabs_phone_number_id is not null;

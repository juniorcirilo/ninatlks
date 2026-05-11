-- Permite vincular acordos a conversas de WhatsApp/Chat (não só voice_calls)
ALTER TABLE public.payment_arrangements
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_arrangements_conversation_id
  ON public.payment_arrangements(conversation_id)
  WHERE conversation_id IS NOT NULL;
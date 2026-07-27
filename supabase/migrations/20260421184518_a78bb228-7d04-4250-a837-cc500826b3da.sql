ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS last_customer_msg_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_conversations_last_customer_msg_at
  ON public.conversations(last_customer_msg_at);
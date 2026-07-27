-- RPC para marcar manualmente um acordo como pago
-- Usado quando o pagamento ocorre fora do fluxo Asaas (Pix manual, dinheiro,
-- transferência, ou quando o webhook falhou). Espelha o que o asaas-webhook faz
-- ao receber PAYMENT_CONFIRMED/PAYMENT_RECEIVED.
--
-- Transições permitidas: pendente | atrasado -> pago
-- Side-effects: payment_arrangements.status='pago' + paid_at, debts.status='pago',
-- audit_log entry.

CREATE OR REPLACE FUNCTION public.mark_arrangement_paid(
  p_arrangement_id uuid,
  p_payment_method text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arr record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, account_id, debt_id, status, paid_at, metadata
    INTO v_arr
    FROM public.payment_arrangements
   WHERE id = p_arrangement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'arrangement not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_account_member(v_uid, v_arr.account_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_arr.status NOT IN ('pendente'::arrangement_status, 'atrasado'::arrangement_status) THEN
    RAISE EXCEPTION 'invalid transition: status=% cannot move to pago', v_arr.status
      USING ERRCODE = '22023';
  END IF;

  -- Atualiza o acordo
  UPDATE public.payment_arrangements
     SET status   = 'pago'::arrangement_status,
         paid_at  = COALESCE(paid_at, v_now),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'manual_payment', jsonb_build_object(
             'marked_by',     v_uid,
             'marked_at',     v_now,
             'payment_method', p_payment_method,
             'note',          p_note
           )
         ),
         updated_at = v_now
   WHERE id = p_arrangement_id;

  -- Atualiza a dívida correspondente (mesmo comportamento do asaas-webhook)
  UPDATE public.debts
     SET status = 'pago'::debt_status,
         updated_at = v_now
   WHERE id = v_arr.debt_id;

  -- Log de auditoria
  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (
    v_arr.account_id,
    v_uid,
    'arrangement.mark_paid',
    'payment_arrangement',
    p_arrangement_id::text,
    jsonb_build_object('payment_method', p_payment_method, 'note', p_note)
  );

  RETURN jsonb_build_object('ok', true, 'arrangement_id', p_arrangement_id, 'paid_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_arrangement_paid(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_arrangement_paid(uuid, text, text) TO authenticated;
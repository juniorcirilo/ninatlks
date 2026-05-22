
CREATE OR REPLACE FUNCTION public.tg_contact_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' and new.stage_id is not null then
    new.stage_changed_at := now();
  elsif tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  end if;
  return new;
end$function$;

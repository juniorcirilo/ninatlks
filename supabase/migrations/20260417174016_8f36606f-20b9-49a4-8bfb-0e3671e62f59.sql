do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'channel_type' and e.enumlabel = 'messenger'
  ) then
    alter type public.channel_type add value 'messenger';
  end if;
end $$;
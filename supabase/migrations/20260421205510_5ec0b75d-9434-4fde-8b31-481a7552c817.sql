do $$
begin
  if not exists (
    select 1 from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'channel_type' and pg_enum.enumlabel = 'telegram'
  ) then
    alter type public.channel_type add value 'telegram';
  end if;
end $$;
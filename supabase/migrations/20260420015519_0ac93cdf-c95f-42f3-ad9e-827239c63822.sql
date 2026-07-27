-- View foi flagada como SECURITY DEFINER VIEW (anti-pattern). Removemos
-- e o frontend chama nexus_cron_status() diretamente via RPC.
DROP VIEW IF EXISTS public.nexus_cron_jobs;
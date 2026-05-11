UPDATE public.channels
SET config = config || '{"zernio_username":"ghmbarboza","zernio_account_id":"69e7aa337dea335c2b1cdc74"}'::jsonb,
    updated_at = now()
WHERE id = '84a17c7b-ec2d-4faa-ae4c-bc29ef44ed3d';
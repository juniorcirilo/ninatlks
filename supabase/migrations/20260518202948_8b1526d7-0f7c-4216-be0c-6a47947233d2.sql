
INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdfs', 'quote-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- path layout: {account_id}/{quote_id}.pdf
CREATE POLICY "quote_pdfs_select_account_members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'quote-pdfs'
  AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "quote_pdfs_insert_account_members"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'quote-pdfs'
  AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

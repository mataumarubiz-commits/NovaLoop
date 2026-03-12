-- 020_invoices_pdf_path.sql (idempotent)
-- invoices.pdf_path が無い環境用（007 未実行時）。007 と重複しても IF NOT EXISTS で安全。

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_path text;

-- 023_invoices_invoice_name.sql (idempotent)
-- invoices.invoice_name が無い環境用（002/005 未実行時）。請求書詳細で select するため必須。

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_name text;

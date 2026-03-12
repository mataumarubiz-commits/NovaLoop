-- 017_invoices_mvp_issuance.sql (idempotent)
-- 請求書発行MVP: invoices.total / updated_at、invoice_lines.created_at
-- billing_month は invoice_month カラムで表現（YYYY-MM）。RLS は既存のまま。

-- invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- invoice_lines（001 に created_at がないため追加）
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

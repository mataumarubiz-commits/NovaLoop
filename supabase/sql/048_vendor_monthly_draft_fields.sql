-- 048_vendor_monthly_draft_fields.sql
-- 月末の外注請求土台に件数と備考を保持する

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS memo text;

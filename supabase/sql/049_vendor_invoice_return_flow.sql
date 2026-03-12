-- 049_vendor_invoice_return_flow.sql
-- 外注請求の差し戻しを同一請求IDで修正再提出できるようにする

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS rejected_category text,
  ADD COLUMN IF NOT EXISTS return_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS first_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_count integer NOT NULL DEFAULT 0;

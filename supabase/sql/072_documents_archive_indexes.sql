-- 072_documents_archive_indexes.sql
-- 月別証憑アーカイブ用の一覧・状態絞り込みを高速化する補助 index。
-- 既存の invoice_month / billing_month をそのまま活かし、target_month 列は追加しない。

CREATE INDEX IF NOT EXISTS idx_invoices_org_invoice_month_created_at
  ON public.invoices (org_id, invoice_month DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_org_status_invoice_month
  ON public.invoices (org_id, status, invoice_month DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_org_billing_month_created_at
  ON public.vendor_invoices (org_id, billing_month DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_org_status_billing_month
  ON public.vendor_invoices (org_id, status, billing_month DESC);


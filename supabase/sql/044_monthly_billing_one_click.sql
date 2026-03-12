-- 044_monthly_billing_one_click.sql
-- 月次ワンボタン請求用: 生成ログと請求追跡補助。

CREATE TABLE IF NOT EXISTS public.invoice_generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  billing_month text NOT NULL CHECK (billing_month ~ '^\d{4}-\d{2}$'),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  generated_content_count integer NOT NULL DEFAULT 0,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  duplicate_mode text NOT NULL DEFAULT 'skip_existing'
    CHECK (duplicate_mode IN ('skip_existing', 'allow_additional')),
  source_type text NOT NULL DEFAULT 'billing_bulk',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_generation_logs_org_month
  ON public.invoice_generation_logs (org_id, billing_month, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_generation_logs_invoice
  ON public.invoice_generation_logs (invoice_id);

ALTER TABLE public.invoice_generation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_generation_logs_admin_select ON public.invoice_generation_logs;
CREATE POLICY invoice_generation_logs_admin_select
  ON public.invoice_generation_logs
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS invoice_generation_logs_admin_write ON public.invoice_generation_logs;
CREATE POLICY invoice_generation_logs_admin_write
  ON public.invoice_generation_logs
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_invoices_org_client_month_status
  ON public.invoices (org_id, client_id, invoice_month, status, created_at DESC);

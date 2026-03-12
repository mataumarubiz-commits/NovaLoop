-- 052_bill_change_ops_hardening.sql
-- Bill Change 比較で残っていた運用差分を埋めるための実務強化

-- ---------------------------------------------------------------------------
-- 1) org_settings: 銀行CSV設定
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS payout_csv_format text NOT NULL DEFAULT 'zengin_simple'
    CHECK (payout_csv_format IN ('zengin_simple', 'custom_basic')),
  ADD COLUMN IF NOT EXISTS payout_csv_encoding text NOT NULL DEFAULT 'utf8_bom'
    CHECK (payout_csv_encoding IN ('utf8_bom')),
  ADD COLUMN IF NOT EXISTS payout_csv_delimiter text NOT NULL DEFAULT 'comma'
    CHECK (payout_csv_delimiter IN ('comma')),
  ADD COLUMN IF NOT EXISTS payout_csv_depositor_code text,
  ADD COLUMN IF NOT EXISTS payout_csv_company_name_kana text,
  ADD COLUMN IF NOT EXISTS payout_csv_notes text;

-- ---------------------------------------------------------------------------
-- 2) invoices: ゲスト送付準備メタデータ
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS guest_company_name text,
  ADD COLUMN IF NOT EXISTS send_prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_prepared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_send_prepared_at ON public.invoices(org_id, send_prepared_at DESC);

-- ---------------------------------------------------------------------------
-- 3) invoice_requests: 期限・リマインド管理
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'invoice_request'
    CHECK (request_type IN ('invoice_request', 'vendor_request')),
  ADD COLUMN IF NOT EXISTS request_deadline date,
  ADD COLUMN IF NOT EXISTS reminder_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_lead_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_message text,
  ADD COLUMN IF NOT EXISTS guest_company_name text,
  ADD COLUMN IF NOT EXISTS related_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL;

UPDATE public.invoice_requests
SET request_deadline = COALESCE(request_deadline, due_date)
WHERE request_deadline IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_requests_deadline
  ON public.invoice_requests(org_id, status, request_deadline);

-- ---------------------------------------------------------------------------
-- 4) reminder logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_request_id uuid REFERENCES public.invoice_requests(id) ON DELETE CASCADE,
  vendor_invoice_id uuid REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('manual', 'automatic', 'deadline_soon', 'overdue')),
  recipient_label text,
  recipient_email text,
  message text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_reminder_logs_target_check
    CHECK (
      (invoice_request_id IS NOT NULL AND vendor_invoice_id IS NULL)
      OR (invoice_request_id IS NULL AND vendor_invoice_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminder_logs_org_created
  ON public.invoice_reminder_logs(org_id, created_at DESC);

ALTER TABLE public.invoice_reminder_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_reminder_logs_select_admin ON public.invoice_reminder_logs;
CREATE POLICY invoice_reminder_logs_select_admin
  ON public.invoice_reminder_logs FOR SELECT
  USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS invoice_reminder_logs_write_admin ON public.invoice_reminder_logs;
CREATE POLICY invoice_reminder_logs_write_admin
  ON public.invoice_reminder_logs FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- 5) payout csv exports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_csv_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  export_month text NOT NULL,
  format text NOT NULL DEFAULT 'zengin_simple',
  encoding text NOT NULL DEFAULT 'utf8_bom',
  file_name text NOT NULL,
  line_count integer NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  preview_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_csv_exports_org_created
  ON public.payout_csv_exports(org_id, created_at DESC);

ALTER TABLE public.payout_csv_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_csv_exports_select_admin ON public.payout_csv_exports;
CREATE POLICY payout_csv_exports_select_admin
  ON public.payout_csv_exports FOR SELECT
  USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS payout_csv_exports_write_admin ON public.payout_csv_exports;
CREATE POLICY payout_csv_exports_write_admin
  ON public.payout_csv_exports FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- 6) bulk action logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bulk_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_action_logs_org_created
  ON public.bulk_action_logs(org_id, created_at DESC);

ALTER TABLE public.bulk_action_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_action_logs_select_admin ON public.bulk_action_logs;
CREATE POLICY bulk_action_logs_select_admin
  ON public.bulk_action_logs FOR SELECT
  USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS bulk_action_logs_write_admin ON public.bulk_action_logs;
CREATE POLICY bulk_action_logs_write_admin
  ON public.bulk_action_logs FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- 075_month_close_transfer_freee_full_scope.sql (idempotent)
-- Month-close automation, expense intake metadata, payout transfer abstraction, and freee sync logs.
-- Accounting/finance surfaces remain owner / executive_assistant only.

-- ---------------------------------------------------------------------------
-- Expense intake / receipt collection
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS target_month text,
  ADD COLUMN IF NOT EXISTS expense_date date,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'JPY',
  ADD COLUMN IF NOT EXISTS payee_name text,
  ADD COLUMN IF NOT EXISTS memo text,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS extracted_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS receipt_collection_status text NOT NULL DEFAULT 'not_needed',
  ADD COLUMN IF NOT EXISTS receipt_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_requested_to_type text,
  ADD COLUMN IF NOT EXISTS receipt_requested_to_id uuid,
  ADD COLUMN IF NOT EXISTS receipt_followup_memo text,
  ADD COLUMN IF NOT EXISTS freee_expense_id text,
  ADD COLUMN IF NOT EXISTS freee_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS freee_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE public.expenses
SET
  target_month = COALESCE(target_month, to_char(occurred_on, 'YYYY-MM')),
  expense_date = COALESCE(expense_date, occurred_on),
  project_name = COALESCE(project_name, (
    SELECT p.name FROM public.projects p WHERE p.id = expenses.project_id LIMIT 1
  ))
WHERE target_month IS NULL
   OR expense_date IS NULL
   OR (project_name IS NULL AND project_id IS NOT NULL);

ALTER TABLE public.expenses
  ALTER COLUMN target_month SET DEFAULT to_char(current_date, 'YYYY-MM'),
  ALTER COLUMN expense_date SET DEFAULT current_date;

DO $$
BEGIN
  ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_target_month_format_check CHECK (target_month ~ '^\d{4}-\d{2}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_org_target_month
  ON public.expenses(org_id, target_month, status);

CREATE INDEX IF NOT EXISTS idx_expenses_org_freee_sync
  ON public.expenses(org_id, freee_sync_status, target_month);

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'project_direct',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_org_active
  ON public.expense_categories(org_id, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Billing / vendor / payout automation metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_billing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  eligible_statuses jsonb NOT NULL DEFAULT '["delivered","published","rejected"]'::jsonb,
  close_day integer,
  issue_day integer,
  payment_due_rule text NOT NULL DEFAULT 'next_month_end',
  invoice_title_template text,
  freee_partner_id text,
  freee_sync_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_id)
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_rule_id uuid REFERENCES public.client_billing_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profitability_target numeric(6,4),
  ADD COLUMN IF NOT EXISTS freee_partner_id text;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS default_pricing_type text,
  ADD COLUMN IF NOT EXISTS default_unit_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_term_rule text,
  ADD COLUMN IF NOT EXISTS freee_partner_id text;

CREATE TABLE IF NOT EXISTS public.vendor_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  branch_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'ordinary'
    CHECK (account_type IN ('ordinary', 'checking', 'savings')),
  account_number text NOT NULL,
  account_holder text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_org_vendor ON public.vendor_bank_accounts(org_id, vendor_id);

ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS primary_vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_status text,
  ADD COLUMN IF NOT EXISTS profitability_status text,
  ADD COLUMN IF NOT EXISTS payout_target_flag boolean NOT NULL DEFAULT true;

ALTER TABLE public.content_vendor_assignments
  ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'per_content',
  ADD COLUMN IF NOT EXISTS unit_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS quantity numeric(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS option_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS override_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS payout_target_flag boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.content_vendor_assignments
SET unit_price = COALESCE(unit_price, unit_price_override)
WHERE unit_price IS NULL;

CREATE INDEX IF NOT EXISTS idx_cva_org_content_status
  ON public.content_vendor_assignments(org_id, content_id, status);

CREATE INDEX IF NOT EXISTS idx_cva_org_vendor_status
  ON public.content_vendor_assignments(org_id, vendor_id, status);

ALTER TABLE public.vendor_invoices
  DROP CONSTRAINT IF EXISTS vendor_invoices_status_check;

ALTER TABLE public.vendor_invoices
  ADD CONSTRAINT vendor_invoices_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'payout_generated', 'paid', 'void'));

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS target_month text,
  ADD COLUMN IF NOT EXISTS total_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS freee_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS freee_synced_at timestamptz;

UPDATE public.vendor_invoices
SET
  target_month = COALESCE(target_month, billing_month),
  total_amount = COALESCE(total_amount, total)
WHERE target_month IS NULL
   OR total_amount IS NULL;

ALTER TABLE public.vendor_invoice_lines
  ADD COLUMN IF NOT EXISTS content_vendor_assignment_id uuid REFERENCES public.content_vendor_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_status_check;

ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('draft', 'scheduled', 'approval_pending', 'approved', 'queued', 'processing', 'paid', 'failed', 'cancelled', 'reversed', 'void'));

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS target_month text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS freee_payout_id text,
  ADD COLUMN IF NOT EXISTS freee_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS freee_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.payouts
SET target_month = COALESCE(target_month, to_char(pay_date, 'YYYY-MM'))
WHERE target_month IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_org_target_month
  ON public.vendor_invoices(org_id, target_month, status);

CREATE INDEX IF NOT EXISTS idx_payouts_org_target_month
  ON public.payouts(org_id, target_month, status);

-- ---------------------------------------------------------------------------
-- Close cockpit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.closing_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month text NOT NULL CHECK (target_month ~ '^\d{4}-\d{2}$'),
  check_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'resolved')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, target_month, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_closing_checks_org_month_status
  ON public.closing_checks(org_id, target_month, status, severity);

CREATE INDEX IF NOT EXISTS idx_closing_checks_org_entity
  ON public.closing_checks(org_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month text NOT NULL CHECK (target_month ~ '^\d{4}-\d{2}$'),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'blocked', 'completed', 'failed')),
  started_by_user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_close_runs_org_month
  ON public.close_runs(org_id, target_month, created_at DESC);

-- ---------------------------------------------------------------------------
-- freee connection and sync logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_freee_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id text,
  status text NOT NULL DEFAULT 'setup_required' CHECK (status IN ('setup_required', 'active', 'expired', 'error', 'revoked')),
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by_user_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS public.freee_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month text,
  entity_type text NOT NULL CHECK (entity_type IN ('invoice', 'expense', 'payout', 'payout_batch')),
  entity_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'synced', 'failed', 'skipped')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb,
  error_message text,
  external_id text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_freee_sync_logs_org_month
  ON public.freee_sync_logs(org_id, target_month, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_freee_sync_logs_entity
  ON public.freee_sync_logs(org_id, entity_type, entity_id, created_at DESC);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS freee_invoice_id text,
  ADD COLUMN IF NOT EXISTS freee_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS freee_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoices_org_freee_sync
  ON public.invoices(org_id, freee_sync_status, invoice_month);

-- ---------------------------------------------------------------------------
-- Transfer abstraction. This does not move money by itself; provider adapters
-- and manual execution logs are recorded here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transfer_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month text NOT NULL CHECK (target_month ~ '^\d{4}-\d{2}$'),
  total_count integer NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'queued', 'processing', 'partial_success', 'succeeded', 'failed', 'cancelled')),
  provider text NOT NULL DEFAULT 'manual',
  approved_by_user_id uuid,
  approved_at timestamptz,
  executed_by_user_id uuid,
  executed_at timestamptz,
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_batch_id uuid NOT NULL REFERENCES public.transfer_batches(id) ON DELETE CASCADE,
  payout_id uuid NOT NULL REFERENCES public.payouts(id) ON DELETE CASCADE,
  vendor_bank_account_id uuid REFERENCES public.vendor_bank_accounts(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'manual',
  provider_transfer_id text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'reversed', 'skipped')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  beneficiary_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.payout_batch_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transfer_batch_id uuid NOT NULL REFERENCES public.transfer_batches(id) ON DELETE CASCADE,
  stage integer NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'execute', 'cancel')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_batch_id, stage, actor_user_id, action)
);

CREATE INDEX IF NOT EXISTS idx_transfer_batches_org_month
  ON public.transfer_batches(org_id, target_month, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transfers_org_batch
  ON public.transfers(org_id, transfer_batch_id, status);

CREATE INDEX IF NOT EXISTS idx_transfers_org_payout
  ON public.transfers(org_id, payout_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TRIGGER tr_expense_categories_updated
    BEFORE UPDATE ON public.expense_categories
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_client_billing_rules_updated
    BEFORE UPDATE ON public.client_billing_rules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_content_vendor_assignments_updated
    BEFORE UPDATE ON public.content_vendor_assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_closing_checks_updated
    BEFORE UPDATE ON public.closing_checks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_close_runs_updated
    BEFORE UPDATE ON public.close_runs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_org_freee_connections_updated
    BEFORE UPDATE ON public.org_freee_connections
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_payouts_updated
    BEFORE UPDATE ON public.payouts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_transfer_batches_updated
    BEFORE UPDATE ON public.transfer_batches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER tr_transfers_updated
    BEFORE UPDATE ON public.transfers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_freee_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.freee_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_batch_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_categories_admin ON public.expense_categories;
CREATE POLICY expense_categories_admin ON public.expense_categories
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS client_billing_rules_admin ON public.client_billing_rules;
CREATE POLICY client_billing_rules_admin ON public.client_billing_rules
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS closing_checks_admin ON public.closing_checks;
CREATE POLICY closing_checks_admin ON public.closing_checks
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS close_runs_admin ON public.close_runs;
CREATE POLICY close_runs_admin ON public.close_runs
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS org_freee_connections_admin ON public.org_freee_connections;
CREATE POLICY org_freee_connections_admin ON public.org_freee_connections
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS freee_sync_logs_admin ON public.freee_sync_logs;
CREATE POLICY freee_sync_logs_admin ON public.freee_sync_logs
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS transfer_batches_admin ON public.transfer_batches;
CREATE POLICY transfer_batches_admin ON public.transfer_batches
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS transfers_admin ON public.transfers;
CREATE POLICY transfers_admin ON public.transfers
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS payout_batch_approvals_admin ON public.payout_batch_approvals;
CREATE POLICY payout_batch_approvals_admin ON public.payout_batch_approvals
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS vendor_bank_accounts_select_self_or_admin ON public.vendor_bank_accounts;
CREATE POLICY vendor_bank_accounts_select_self_or_admin ON public.vendor_bank_accounts
  FOR SELECT
  USING (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_bank_accounts.org_id
        AND vu.vendor_id = vendor_bank_accounts.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_bank_accounts_write_self_or_admin ON public.vendor_bank_accounts;
CREATE POLICY vendor_bank_accounts_write_self_or_admin ON public.vendor_bank_accounts
  FOR INSERT
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_bank_accounts.org_id
        AND vu.vendor_id = vendor_bank_accounts.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_bank_accounts_update_self_or_admin ON public.vendor_bank_accounts;
CREATE POLICY vendor_bank_accounts_update_self_or_admin ON public.vendor_bank_accounts
  FOR UPDATE
  USING (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_bank_accounts.org_id
        AND vu.vendor_id = vendor_bank_accounts.vendor_id
        AND vu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_bank_accounts.org_id
        AND vu.vendor_id = vendor_bank_accounts.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

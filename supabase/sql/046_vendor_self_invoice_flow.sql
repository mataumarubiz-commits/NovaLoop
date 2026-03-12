-- 046_vendor_self_invoice_flow.sql
-- 外注セルフ請求確認フロー

CREATE TABLE IF NOT EXISTS public.vendor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  display_name text,
  legal_name text,
  company_name text,
  email text,
  billing_name text,
  postal_code text,
  address text,
  registration_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_org_vendor ON public.vendor_profiles(org_id, vendor_id);

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

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS rejected_reason text;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS vendor_profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS vendor_bank_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vendor_invoice_lines
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'content_auto'));

ALTER TABLE public.vendor_invoice_lines
  ADD COLUMN IF NOT EXISTS source_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vendor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_profiles_select_self_or_admin ON public.vendor_profiles;
CREATE POLICY vendor_profiles_select_self_or_admin ON public.vendor_profiles
  FOR SELECT
  USING (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_profiles.org_id
        AND vu.vendor_id = vendor_profiles.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_profiles_write_self_or_admin ON public.vendor_profiles;
CREATE POLICY vendor_profiles_write_self_or_admin ON public.vendor_profiles
  FOR INSERT
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_profiles.org_id
        AND vu.vendor_id = vendor_profiles.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_profiles_update_self_or_admin ON public.vendor_profiles;
CREATE POLICY vendor_profiles_update_self_or_admin ON public.vendor_profiles
  FOR UPDATE
  USING (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_profiles.org_id
        AND vu.vendor_id = vendor_profiles.vendor_id
        AND vu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
    OR EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.org_id = vendor_profiles.org_id
        AND vu.vendor_id = vendor_profiles.vendor_id
        AND vu.user_id = auth.uid()
    )
  );

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

DROP POLICY IF EXISTS vendor_invoices_vendor_select ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_select ON public.vendor_invoices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_invoices_vendor_insert ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_insert ON public.vendor_invoices
  FOR INSERT
  WITH CHECK (
    status IN ('draft', 'submitted')
    AND EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_invoices_vendor_update ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_update ON public.vendor_invoices
  FOR UPDATE
  USING (
    status IN ('draft', 'submitted', 'rejected')
    AND EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('draft', 'submitted')
    AND EXISTS (
      SELECT 1
      FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS vendor_invoice_lines_vendor ON public.vendor_invoice_lines;
CREATE POLICY vendor_invoice_lines_vendor_select ON public.vendor_invoice_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
    )
  );

CREATE POLICY vendor_invoice_lines_vendor_write ON public.vendor_invoice_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY vendor_invoice_lines_vendor_update ON public.vendor_invoice_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft', 'rejected')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY vendor_invoice_lines_vendor_delete ON public.vendor_invoice_lines
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft', 'rejected')
    )
  );

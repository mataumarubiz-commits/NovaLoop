-- 043_bill_change_gap_close.sql
-- Bill Change 差分のうち、既存UIを崩さず統合できる最小データ拡張。

-- ---------------------------------------------------------------------------
-- 1) org_settings 拡張: 自社情報
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS business_entity_type text NOT NULL DEFAULT 'corporate'
  CHECK (business_entity_type IN ('corporate', 'sole_proprietor'));
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS issuer_zip text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS issuer_phone text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS issuer_email text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS issuer_registration_number text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS invoice_note_fixed text;

-- ---------------------------------------------------------------------------
-- 2) 複数口座: 自社口座
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  branch_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'ordinary' CHECK (account_type IN ('ordinary', 'checking', 'savings')),
  account_number text NOT NULL,
  account_holder text NOT NULL,
  account_holder_kana text,
  depositor_code text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_bank_accounts_org_id ON public.org_bank_accounts(org_id);

ALTER TABLE public.org_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_bank_accounts_select_org_members ON public.org_bank_accounts;
CREATE POLICY org_bank_accounts_select_org_members ON public.org_bank_accounts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = org_bank_accounts.org_id
    )
  );

DROP POLICY IF EXISTS org_bank_accounts_admin_write ON public.org_bank_accounts;
CREATE POLICY org_bank_accounts_admin_write ON public.org_bank_accounts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = org_bank_accounts.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = org_bank_accounts.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

CREATE OR REPLACE FUNCTION public.org_bank_accounts_single_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.org_bank_accounts
      SET is_default = false, updated_at = now()
      WHERE org_id = NEW.org_id
        AND id <> NEW.id
        AND is_default = true;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_bank_accounts_single_default ON public.org_bank_accounts;
CREATE TRIGGER trg_org_bank_accounts_single_default
  BEFORE INSERT OR UPDATE ON public.org_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.org_bank_accounts_single_default();

-- ---------------------------------------------------------------------------
-- 3) clients 拡張: 取引先請求情報
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS billing_name text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- 4) vendors 拡張: 支払CSV向け振込先情報
-- ---------------------------------------------------------------------------
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_branch text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_account_type text
  CHECK (bank_account_type IN ('ordinary', 'checking', 'savings'));
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_account_holder text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS bank_account_holder_kana text;

-- ---------------------------------------------------------------------------
-- 5) invoices 拡張: 手動請求 / 税 / 源泉 / 口座 / ゲスト宛先 / コピー新規
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'exempt'
  CHECK (tax_mode IN ('exempt', 'exclusive', 'inclusive'));
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS withholding_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS withholding_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.org_bank_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issuer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bank_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS guest_client_name text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS guest_client_email text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS guest_client_address text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS copied_from_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'billing'
  CHECK (source_type IN ('billing', 'manual', 'copy', 'request'));
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_invoices_bank_account_id ON public.invoices(bank_account_id);

-- ---------------------------------------------------------------------------
-- 6) 請求依頼
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  guest_name text,
  recipient_email text,
  requested_title text NOT NULL DEFAULT '',
  requested_description text NOT NULL DEFAULT '',
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft', 'sent', 'viewed', 'issued', 'expired', 'canceled')),
  last_sent_at timestamptz,
  issued_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_requests_org ON public.invoice_requests(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_requests_status ON public.invoice_requests(org_id, status, due_date);

ALTER TABLE public.invoice_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_requests_select_org_members ON public.invoice_requests;
CREATE POLICY invoice_requests_select_org_members ON public.invoice_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = invoice_requests.org_id
    )
  );

DROP POLICY IF EXISTS invoice_requests_admin_write ON public.invoice_requests;
CREATE POLICY invoice_requests_admin_write ON public.invoice_requests
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = invoice_requests.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = invoice_requests.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

-- ---------------------------------------------------------------------------
-- 7) 紹介コード
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'disabled')),
  issued_to_email text,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_org ON public.referral_codes(org_id, created_at DESC);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_codes_select_org_members ON public.referral_codes;
CREATE POLICY referral_codes_select_org_members ON public.referral_codes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = referral_codes.org_id
    )
  );

DROP POLICY IF EXISTS referral_codes_admin_write ON public.referral_codes;
CREATE POLICY referral_codes_admin_write ON public.referral_codes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = referral_codes.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = referral_codes.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

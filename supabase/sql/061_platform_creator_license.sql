-- 061_platform_creator_license.sql (idempotent)
-- Platform-level creator license sales, manual bank-transfer settlement, and
-- owner guardrails for paid org creation.

-- ---------------------------------------------------------------------------
-- Platform admin + billing settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_billing_settings (
  id boolean PRIMARY KEY DEFAULT true,
  seller_name text NOT NULL,
  seller_address text NOT NULL,
  seller_phone text NOT NULL,
  seller_email text NOT NULL,
  bank_name text NOT NULL,
  bank_branch_name text NOT NULL,
  bank_branch_code text NOT NULL,
  bank_account_type text NOT NULL,
  bank_account_number text NOT NULL,
  bank_account_holder text NOT NULL,
  transfer_fee_note text NOT NULL,
  invoice_registration_number text,
  license_price_jpy numeric(12,0) NOT NULL DEFAULT 300000,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_billing_settings (
  id,
  seller_name,
  seller_address,
  seller_phone,
  seller_email,
  bank_name,
  bank_branch_name,
  bank_branch_code,
  bank_account_type,
  bank_account_number,
  bank_account_holder,
  transfer_fee_note,
  invoice_registration_number,
  license_price_jpy
)
VALUES (
  true,
  '松丸煌明',
  '埼玉県深谷市上柴町東5-11-16',
  '07076184470',
  'mataumaru.biz@gmail.com',
  'GMOあおぞらネット銀行',
  'ビジネス第二支店',
  '202',
  '普通',
  '1103468',
  'マツマル コウメイ',
  '振込手数料はお客様負担',
  null,
  300000
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Creator license master data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text,
  full_name text NOT NULL,
  company_name text,
  address text NOT NULL,
  phone text NOT NULL,
  contact_email text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending_payment', 'active', 'transferred', 'revoked')),
  activated_at timestamptz,
  transferred_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_entitlements_user_id_key UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.entitlement_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement_id uuid NOT NULL REFERENCES public.creator_entitlements(id) ON DELETE CASCADE,
  request_number text NOT NULL UNIQUE,
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending_invoice', 'invoice_issued', 'paid', 'canceled')),
  full_name text NOT NULL,
  company_name text,
  address text NOT NULL,
  phone text NOT NULL,
  contact_email text NOT NULL,
  google_email text,
  note text,
  license_price_jpy numeric(12,0) NOT NULL DEFAULT 300000,
  issued_at timestamptz,
  due_date date,
  invoice_pdf_path text,
  receipt_pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entitlement_id uuid NOT NULL REFERENCES public.creator_entitlements(id) ON DELETE CASCADE,
  purchase_request_id uuid NOT NULL REFERENCES public.entitlement_purchase_requests(id) ON DELETE CASCADE,
  request_number text NOT NULL UNIQUE,
  invoice_number text NOT NULL UNIQUE,
  receipt_number text UNIQUE,
  transfer_reference text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('issued', 'paid')),
  amount_jpy numeric(12,0) NOT NULL DEFAULT 300000,
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  invoice_pdf_path text,
  receipt_pdf_path text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  paid_at timestamptz,
  paid_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entitlement_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_entitlement_id uuid REFERENCES public.creator_entitlements(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'rejected', 'completed')) DEFAULT 'pending',
  current_google_email text,
  previous_google_email text,
  full_name text NOT NULL,
  company_name text,
  address text NOT NULL,
  phone text NOT NULL,
  contact_email text NOT NULL,
  reason text NOT NULL,
  reference_note text,
  move_owned_orgs boolean NOT NULL DEFAULT true,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_entitlements_status_idx
  ON public.creator_entitlements (status, user_id);

CREATE INDEX IF NOT EXISTS entitlement_purchase_requests_entitlement_idx
  ON public.entitlement_purchase_requests (entitlement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_payment_requests_purchase_idx
  ON public.platform_payment_requests (purchase_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS entitlement_transfer_requests_target_idx
  ON public.entitlement_transfer_requests (target_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Sequences for request / receipt numbering
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.platform_purchase_request_seq START WITH 1001;
CREATE SEQUENCE IF NOT EXISTS public.platform_receipt_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.allocate_platform_purchase_identity()
RETURNS TABLE (
  request_number text,
  invoice_number text,
  transfer_reference text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_value bigint;
  date_part text := to_char(now() at time zone 'Asia/Tokyo', 'YYYYMMDD');
  seq_part text;
BEGIN
  seq_value := nextval('public.platform_purchase_request_seq');
  seq_part := lpad(seq_value::text, 6, '0');

  RETURN QUERY
  SELECT
    format('PLAT-%s-%s', date_part, seq_part),
    format('INV-PLAT-%s-%s', date_part, seq_part),
    format('NL%s', right(seq_part, 6));
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_platform_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_value bigint;
  date_part text := to_char(now() at time zone 'Asia/Tokyo', 'YYYYMMDD');
BEGIN
  seq_value := nextval('public.platform_receipt_seq');
  RETURN format('RCT-PLAT-%s-%s', date_part, lpad(seq_value::text, 6, '0'));
END;
$$;

-- ---------------------------------------------------------------------------
-- Organizations + owner grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS creator_entitlement_id uuid REFERENCES public.creator_entitlements(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.owner_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creator_entitlement_id uuid REFERENCES public.creator_entitlements(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active', 'transferred', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_grants_one_active_owner_per_org_idx
  ON public.owner_grants (org_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS owner_grants_user_idx
  ON public.owner_grants (user_id, status, created_at DESC);

INSERT INTO public.owner_grants (org_id, user_id, status, created_at, updated_at)
SELECT
  au.org_id,
  au.user_id,
  'active',
  COALESCE(au.created_at, now()),
  now()
FROM public.app_users au
WHERE au.role = 'owner'
  AND NOT EXISTS (
    SELECT 1
    FROM public.owner_grants og
    WHERE og.org_id = au.org_id
      AND og.user_id = au.user_id
      AND og.status = 'active'
  );

UPDATE public.organizations o
SET created_by_user_id = og.user_id
FROM public.owner_grants og
WHERE o.id = og.org_id
  AND og.status = 'active'
  AND o.created_by_user_id IS NULL;

CREATE OR REPLACE FUNCTION public.require_owner_grant_for_app_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'owner' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.owner_grants og
    WHERE og.org_id = NEW.org_id
      AND og.user_id = NEW.user_id
      AND og.status = 'active'
  ) THEN
    RAISE EXCEPTION 'owner role requires an active owner_grant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_owner_grant_for_app_user ON public.app_users;
CREATE TRIGGER trg_require_owner_grant_for_app_user
BEFORE INSERT OR UPDATE OF role, org_id, user_id
ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.require_owner_grant_for_app_user();

DROP POLICY IF EXISTS organizations_insert_authenticated ON public.organizations;

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin_me()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_orgs_me()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.creator_entitlements ce
    WHERE ce.user_id = auth.uid()
      AND ce.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.create_platform_purchase_request(
  p_full_name text,
  p_company_name text,
  p_address text,
  p_phone text,
  p_contact_email text,
  p_note text
)
RETURNS TABLE (
  entitlement_id uuid,
  purchase_request_id uuid,
  payment_request_id uuid,
  request_number text,
  invoice_number text,
  transfer_reference text,
  issued_at timestamptz,
  due_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_google_email text;
  v_entitlement_id uuid;
  v_purchase_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_request_number text;
  v_invoice_number text;
  v_transfer_reference text;
  v_issued_at timestamptz := now();
  v_due_date date := ((now() at time zone 'Asia/Tokyo')::date + 7);
  v_price numeric(12,0);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT email INTO v_google_email
  FROM auth.users
  WHERE id = v_user_id;

  IF EXISTS (
    SELECT 1
    FROM public.creator_entitlements ce
    WHERE ce.user_id = v_user_id
      AND ce.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active entitlement already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.creator_entitlements ce
    WHERE ce.user_id = v_user_id
      AND ce.status = 'pending_payment'
  ) THEN
    RAISE EXCEPTION 'Pending payment already exists';
  END IF;

  SELECT license_price_jpy INTO v_price
  FROM public.platform_billing_settings
  WHERE id = true;

  SELECT api.request_number, api.invoice_number, api.transfer_reference
  INTO v_request_number, v_invoice_number, v_transfer_reference
  FROM public.allocate_platform_purchase_identity() api;

  INSERT INTO public.creator_profiles (
    user_id,
    google_email,
    full_name,
    company_name,
    address,
    phone,
    contact_email,
    note,
    updated_at
  )
  VALUES (
    v_user_id,
    v_google_email,
    p_full_name,
    nullif(p_company_name, ''),
    p_address,
    p_phone,
    p_contact_email,
    nullif(p_note, ''),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    google_email = EXCLUDED.google_email,
    full_name = EXCLUDED.full_name,
    company_name = EXCLUDED.company_name,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    contact_email = EXCLUDED.contact_email,
    note = EXCLUDED.note,
    updated_at = now();

  INSERT INTO public.creator_entitlements (id, user_id, status)
  VALUES (gen_random_uuid(), v_user_id, 'pending_payment')
  RETURNING id INTO v_entitlement_id;

  INSERT INTO public.entitlement_purchase_requests (
    id,
    user_id,
    entitlement_id,
    request_number,
    invoice_number,
    status,
    full_name,
    company_name,
    address,
    phone,
    contact_email,
    google_email,
    note,
    license_price_jpy,
    issued_at,
    due_date
  )
  VALUES (
    v_purchase_id,
    v_user_id,
    v_entitlement_id,
    v_request_number,
    v_invoice_number,
    'pending_invoice',
    p_full_name,
    nullif(p_company_name, ''),
    p_address,
    p_phone,
    p_contact_email,
    v_google_email,
    nullif(p_note, ''),
    COALESCE(v_price, 300000),
    v_issued_at,
    v_due_date
  );

  INSERT INTO public.platform_payment_requests (
    id,
    user_id,
    entitlement_id,
    purchase_request_id,
    request_number,
    invoice_number,
    transfer_reference,
    status,
    amount_jpy,
    issued_at,
    due_date
  )
  VALUES (
    v_payment_id,
    v_user_id,
    v_entitlement_id,
    v_purchase_id,
    v_request_number,
    v_invoice_number,
    v_transfer_reference,
    'issued',
    COALESCE(v_price, 300000),
    v_issued_at,
    v_due_date
  );

  RETURN QUERY
  SELECT
    v_entitlement_id,
    v_purchase_id,
    v_payment_id,
    v_request_number,
    v_invoice_number,
    v_transfer_reference,
    v_issued_at,
    v_due_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_org_with_entitlement(
  p_org_name text,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org_id uuid := gen_random_uuid();
  v_entitlement_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT ce.id
  INTO v_entitlement_id
  FROM public.creator_entitlements ce
  WHERE ce.user_id = v_user_id
    AND ce.status = 'active';

  IF v_entitlement_id IS NULL THEN
    RAISE EXCEPTION 'Active creator entitlement required';
  END IF;

  INSERT INTO public.organizations (id, name, created_by_user_id, creator_entitlement_id)
  VALUES (v_org_id, p_org_name, v_user_id, v_entitlement_id);

  INSERT INTO public.owner_grants (org_id, user_id, creator_entitlement_id, status)
  VALUES (v_org_id, v_user_id, v_entitlement_id, 'active');

  INSERT INTO public.app_users (org_id, user_id, role, status, display_name)
  VALUES (v_org_id, v_user_id, 'owner', 'active', nullif(p_display_name, ''))
  ON CONFLICT (user_id, org_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    display_name = COALESCE(EXCLUDED.display_name, public.app_users.display_name);

  INSERT INTO public.user_profiles (user_id, display_name, active_org_id, updated_at)
  VALUES (v_user_id, COALESCE(nullif(p_display_name, ''), ''), v_org_id, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    active_org_id = EXCLUDED.active_org_id,
    updated_at = now(),
    display_name = CASE
      WHEN nullif(p_display_name, '') IS NOT NULL THEN EXCLUDED.display_name
      ELSE public.user_profiles.display_name
    END;

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_entitlement_transfer(
  p_transfer_request_id uuid,
  p_platform_admin_user_id uuid
)
RETURNS TABLE (
  entitlement_id uuid,
  new_user_id uuid,
  moved_org_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.entitlement_transfer_requests%ROWTYPE;
  v_entitlement public.creator_entitlements%ROWTYPE;
  v_org record;
  v_old_user_id uuid;
  v_count integer := 0;
BEGIN
  SELECT *
  INTO v_request
  FROM public.entitlement_transfer_requests
  WHERE id = p_transfer_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Transfer request already decided';
  END IF;

  IF v_request.source_entitlement_id IS NULL THEN
    RAISE EXCEPTION 'Source entitlement is not linked';
  END IF;

  SELECT *
  INTO v_entitlement
  FROM public.creator_entitlements
  WHERE id = v_request.source_entitlement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement not found';
  END IF;

  v_old_user_id := v_entitlement.user_id;

  IF v_request.target_user_id = v_old_user_id THEN
    RAISE EXCEPTION 'Target account already owns this entitlement';
  END IF;

  UPDATE public.creator_entitlements
  SET
    user_id = v_request.target_user_id,
    status = 'active',
    transferred_at = now(),
    updated_at = now()
  WHERE id = v_entitlement.id;

  IF v_request.move_owned_orgs THEN
    FOR v_org IN
      SELECT org_id
      FROM public.owner_grants
      WHERE user_id = v_old_user_id
        AND status = 'active'
      ORDER BY created_at
    LOOP
      UPDATE public.owner_grants
      SET status = 'transferred', ended_at = now(), updated_at = now()
      WHERE org_id = v_org.org_id
        AND user_id = v_old_user_id
        AND status = 'active';

      INSERT INTO public.owner_grants (org_id, user_id, creator_entitlement_id, status)
      VALUES (v_org.org_id, v_request.target_user_id, v_entitlement.id, 'active');

      UPDATE public.app_users
      SET role = 'member', status = 'transferred'
      WHERE org_id = v_org.org_id
        AND user_id = v_old_user_id
        AND role = 'owner';

      INSERT INTO public.app_users (org_id, user_id, role, status)
      VALUES (v_org.org_id, v_request.target_user_id, 'owner', 'active')
      ON CONFLICT (user_id, org_id) DO UPDATE
      SET role = 'owner', status = 'active';

      UPDATE public.organizations
      SET created_by_user_id = v_request.target_user_id,
          creator_entitlement_id = v_entitlement.id
      WHERE id = v_org.org_id;

      v_count := v_count + 1;
    END LOOP;
  END IF;

  INSERT INTO public.user_profiles (user_id, display_name, active_org_id, updated_at)
  VALUES (
    v_request.target_user_id,
    COALESCE((SELECT display_name FROM public.user_profiles WHERE user_id = v_request.target_user_id), ''),
    COALESCE(
      (SELECT org_id FROM public.owner_grants WHERE user_id = v_request.target_user_id AND status = 'active' ORDER BY created_at LIMIT 1),
      (SELECT active_org_id FROM public.user_profiles WHERE user_id = v_request.target_user_id)
    ),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET active_org_id = COALESCE(EXCLUDED.active_org_id, public.user_profiles.active_org_id),
      updated_at = now();

  UPDATE public.entitlement_transfer_requests
  SET
    status = 'completed',
    source_user_id = v_old_user_id,
    reviewed_by_user_id = p_platform_admin_user_id,
    reviewed_at = now(),
    completed_at = now(),
    updated_at = now()
  WHERE id = v_request.id;

  RETURN QUERY
  SELECT v_entitlement.id, v_request.target_user_id, v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Storage bucket for platform billing documents
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('platform-documents', 'platform-documents', false)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, public = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- Audit logs: platform actions do not belong to an org.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ALTER COLUMN org_id DROP NOT NULL;

DROP POLICY IF EXISTS audit_logs_select_org_members ON public.audit_logs;
CREATE POLICY audit_logs_select_org_members ON public.audit_logs
  FOR SELECT
  USING (
    (
      public.audit_logs.org_id IS NOT NULL
      AND exists (
        select 1 from public.app_users au
        where au.user_id = auth.uid() and au.org_id = public.audit_logs.org_id
      )
    )
    OR (
      public.audit_logs.org_id IS NULL
      AND public.is_platform_admin_me()
    )
  );

DROP POLICY IF EXISTS audit_logs_insert_admin ON public.audit_logs;
CREATE POLICY audit_logs_insert_admin ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    (
      public.audit_logs.org_id IS NOT NULL
      AND exists (
        select 1 from public.app_users au
        where au.user_id = auth.uid() and au.org_id = public.audit_logs.org_id
          and au.role in ('owner','executive_assistant')
      )
    )
    OR (
      public.audit_logs.org_id IS NULL
      AND public.is_platform_admin_me()
    )
  );

-- ---------------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admins_self_select ON public.platform_admins;
CREATE POLICY platform_admins_self_select ON public.platform_admins
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS platform_billing_settings_select_authenticated ON public.platform_billing_settings;
CREATE POLICY platform_billing_settings_select_authenticated ON public.platform_billing_settings
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS platform_billing_settings_admin_update ON public.platform_billing_settings;
CREATE POLICY platform_billing_settings_admin_update ON public.platform_billing_settings
  FOR UPDATE
  USING (public.is_platform_admin_me())
  WITH CHECK (public.is_platform_admin_me());

DROP POLICY IF EXISTS creator_profiles_select_self_or_platform_admin ON public.creator_profiles;
CREATE POLICY creator_profiles_select_self_or_platform_admin ON public.creator_profiles
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS creator_profiles_insert_self ON public.creator_profiles;
CREATE POLICY creator_profiles_insert_self ON public.creator_profiles
  FOR INSERT
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS creator_profiles_update_self_or_platform_admin ON public.creator_profiles;
CREATE POLICY creator_profiles_update_self_or_platform_admin ON public.creator_profiles
  FOR UPDATE
  USING (user_id = auth.uid() OR public.is_platform_admin_me())
  WITH CHECK (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS creator_entitlements_select_self_or_platform_admin ON public.creator_entitlements;
CREATE POLICY creator_entitlements_select_self_or_platform_admin ON public.creator_entitlements
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS entitlement_purchase_requests_select_self_or_platform_admin ON public.entitlement_purchase_requests;
CREATE POLICY entitlement_purchase_requests_select_self_or_platform_admin ON public.entitlement_purchase_requests
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_platform_admin_me()
    OR EXISTS (
      SELECT 1
      FROM public.creator_entitlements ce
      WHERE ce.id = entitlement_purchase_requests.entitlement_id
        AND ce.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS platform_payment_requests_select_self_or_platform_admin ON public.platform_payment_requests;
CREATE POLICY platform_payment_requests_select_self_or_platform_admin ON public.platform_payment_requests
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_platform_admin_me()
    OR EXISTS (
      SELECT 1
      FROM public.creator_entitlements ce
      WHERE ce.id = platform_payment_requests.entitlement_id
        AND ce.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS entitlement_transfer_requests_select_self_or_platform_admin ON public.entitlement_transfer_requests;
CREATE POLICY entitlement_transfer_requests_select_self_or_platform_admin ON public.entitlement_transfer_requests
  FOR SELECT
  USING (target_user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS entitlement_transfer_requests_insert_self ON public.entitlement_transfer_requests;
CREATE POLICY entitlement_transfer_requests_insert_self ON public.entitlement_transfer_requests
  FOR INSERT
  WITH CHECK (target_user_id = auth.uid());

DROP POLICY IF EXISTS owner_grants_select_self_or_platform_admin ON public.owner_grants;
CREATE POLICY owner_grants_select_self_or_platform_admin ON public.owner_grants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_platform_admin_me()
    OR EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = owner_grants.org_id
        AND au.role in ('owner', 'executive_assistant')
    )
  );

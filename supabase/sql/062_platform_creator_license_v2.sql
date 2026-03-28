-- 062_platform_creator_license_v2.sql
-- Idempotent follow-up for creator-license sales:
-- - stable request numbering
-- - explicit grant_type
-- - recoverable invoice/receipt generation states
-- - idempotent pending-purchase reuse
-- - platform-admin manual entitlement grants

ALTER TABLE public.creator_entitlements
  ADD COLUMN IF NOT EXISTS grant_type text;

ALTER TABLE public.creator_entitlements
  ADD COLUMN IF NOT EXISTS amount_total_jpy numeric(12,0) NOT NULL DEFAULT 0;

ALTER TABLE public.creator_entitlements
  ADD COLUMN IF NOT EXISTS admin_note text;

ALTER TABLE public.creator_entitlements
  ADD COLUMN IF NOT EXISTS granted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.creator_entitlements
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.platform_billing_settings
SET
  seller_name = '松丸煌明',
  seller_address = '埼玉県深谷市上柴町東5-11-16',
  seller_phone = '07076184470',
  seller_email = 'mataumaru.biz@gmail.com',
  bank_name = 'GMOあおぞらネット銀行',
  bank_branch_name = 'ビジネス第二支店',
  bank_branch_code = '202',
  bank_account_type = '普通',
  bank_account_number = '1103468',
  bank_account_holder = 'マツマル　コウメイ',
  transfer_fee_note = '振込手数料はお客様負担です。',
  invoice_registration_number = null,
  license_price_jpy = 300000,
  updated_at = now()
WHERE id = true;

UPDATE public.creator_entitlements
SET grant_type = CASE
  WHEN status = 'transferred' THEN 'transferred'
  ELSE 'paid'
END
WHERE grant_type IS NULL;

UPDATE public.creator_entitlements
SET amount_total_jpy = CASE
  WHEN grant_type IN ('manual_test', 'manual_grant') THEN 0
  ELSE 300000
END
WHERE amount_total_jpy = 0;

ALTER TABLE public.creator_entitlements
  ALTER COLUMN grant_type SET DEFAULT 'paid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_entitlements_grant_type_check'
  ) THEN
    ALTER TABLE public.creator_entitlements
      ADD CONSTRAINT creator_entitlements_grant_type_check
      CHECK (grant_type IN ('paid', 'manual_test', 'manual_grant', 'transferred'));
  END IF;
END $$;

ALTER TABLE public.creator_entitlements
  ALTER COLUMN grant_type SET NOT NULL;

ALTER TABLE public.entitlement_purchase_requests
  ADD COLUMN IF NOT EXISTS invoice_document_status text NOT NULL DEFAULT 'pending_generation';

ALTER TABLE public.entitlement_purchase_requests
  ADD COLUMN IF NOT EXISTS receipt_document_status text NOT NULL DEFAULT 'not_requested';

ALTER TABLE public.platform_payment_requests
  ADD COLUMN IF NOT EXISTS invoice_document_status text NOT NULL DEFAULT 'pending_generation';

ALTER TABLE public.platform_payment_requests
  ADD COLUMN IF NOT EXISTS receipt_document_status text NOT NULL DEFAULT 'not_requested';

UPDATE public.entitlement_purchase_requests
SET invoice_document_status = CASE
  WHEN invoice_pdf_path IS NOT NULL THEN 'ready'
  ELSE COALESCE(invoice_document_status, 'pending_generation')
END,
receipt_document_status = CASE
  WHEN receipt_pdf_path IS NOT NULL THEN 'ready'
  ELSE COALESCE(receipt_document_status, 'not_requested')
END;

UPDATE public.platform_payment_requests
SET invoice_document_status = CASE
  WHEN invoice_pdf_path IS NOT NULL THEN 'ready'
  ELSE COALESCE(invoice_document_status, 'pending_generation')
END,
receipt_document_status = CASE
  WHEN receipt_pdf_path IS NOT NULL THEN 'ready'
  WHEN status = 'paid' THEN COALESCE(receipt_document_status, 'pending_generation')
  ELSE COALESCE(receipt_document_status, 'not_requested')
END;

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
  year_part text := to_char(now() at time zone 'Asia/Tokyo', 'YYYY');
  seq_part text;
BEGIN
  seq_value := nextval('public.platform_purchase_request_seq');
  seq_part := lpad(seq_value::text, 6, '0');

  RETURN QUERY
  SELECT
    format('NVL-%s-%s', year_part, seq_part),
    format('INV-NVL-%s-%s', year_part, seq_part),
    format('NVL%s', seq_part);
END;
$$;

DROP FUNCTION IF EXISTS public.create_platform_purchase_request(text, text, text, text, text, text);

CREATE FUNCTION public.create_platform_purchase_request(
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
  due_date date,
  reused_existing boolean,
  invoice_pdf_path text,
  invoice_document_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_google_email text;
  v_entitlement_id uuid;
  v_purchase_id uuid;
  v_payment_id uuid;
  v_request_number text;
  v_invoice_number text;
  v_transfer_reference text;
  v_issued_at timestamptz;
  v_due_date date;
  v_price numeric(12,0);
  v_invoice_pdf_path text;
  v_invoice_document_status text;
  v_reused_existing boolean := false;
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

  SELECT license_price_jpy INTO v_price
  FROM public.platform_billing_settings
  WHERE id = true;

  SELECT ce.id
  INTO v_entitlement_id
  FROM public.creator_entitlements ce
  WHERE ce.user_id = v_user_id
    AND ce.status = 'pending_payment'
  ORDER BY ce.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_entitlement_id IS NULL THEN
    INSERT INTO public.creator_entitlements (id, user_id, status, grant_type, amount_total_jpy)
    VALUES (gen_random_uuid(), v_user_id, 'pending_payment', 'paid', COALESCE(v_price, 300000))
    RETURNING id INTO v_entitlement_id;
  ELSE
    v_reused_existing := true;
  END IF;

  SELECT
    pr.id,
    pr.request_number,
    pr.invoice_number,
    pr.issued_at,
    pr.due_date,
    pr.invoice_pdf_path,
    pr.invoice_document_status,
    pay.id,
    pay.transfer_reference
  INTO
    v_purchase_id,
    v_request_number,
    v_invoice_number,
    v_issued_at,
    v_due_date,
    v_invoice_pdf_path,
    v_invoice_document_status,
    v_payment_id,
    v_transfer_reference
  FROM public.entitlement_purchase_requests pr
  JOIN public.platform_payment_requests pay
    ON pay.purchase_request_id = pr.id
  WHERE pr.entitlement_id = v_entitlement_id
  ORDER BY pr.created_at DESC, pay.created_at DESC
  LIMIT 1;

  IF v_purchase_id IS NULL OR v_payment_id IS NULL THEN
    SELECT api.request_number, api.invoice_number, api.transfer_reference
    INTO v_request_number, v_invoice_number, v_transfer_reference
    FROM public.allocate_platform_purchase_identity() api;

    v_purchase_id := gen_random_uuid();
    v_payment_id := gen_random_uuid();
    v_issued_at := now();
    v_due_date := ((now() at time zone 'Asia/Tokyo')::date + 7);
    v_invoice_pdf_path := null;
    v_invoice_document_status := 'pending_generation';

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
      due_date,
      invoice_document_status,
      receipt_document_status
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
      v_due_date,
      'pending_generation',
      'not_requested'
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
      due_date,
      invoice_document_status,
      receipt_document_status
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
      v_due_date,
      'pending_generation',
      'not_requested'
    );
  END IF;

  RETURN QUERY
  SELECT
    v_entitlement_id,
    v_purchase_id,
    v_payment_id,
    v_request_number,
    v_invoice_number,
    v_transfer_reference,
    v_issued_at,
    v_due_date,
    v_reused_existing,
    v_invoice_pdf_path,
    COALESCE(v_invoice_document_status, 'pending_generation');
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

  IF EXISTS (
    SELECT 1
    FROM public.creator_entitlements ce
    WHERE ce.user_id = v_request.target_user_id
      AND ce.id <> v_entitlement.id
  ) THEN
    RAISE EXCEPTION 'Target account already has another entitlement row';
  END IF;

  UPDATE public.creator_entitlements
  SET
    user_id = v_request.target_user_id,
    status = 'active',
    grant_type = 'transferred',
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

CREATE OR REPLACE FUNCTION public.grant_creator_entitlement_admin(
  p_target_user_id uuid,
  p_grant_type text,
  p_note text DEFAULT null
)
RETURNS TABLE (
  entitlement_id uuid,
  user_id uuid,
  status text,
  grant_type text,
  reused_existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement public.creator_entitlements%ROWTYPE;
  v_reused_existing boolean := false;
BEGIN
  IF NOT public.is_platform_admin_me() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_grant_type NOT IN ('manual_test', 'manual_grant') THEN
    RAISE EXCEPTION 'Unsupported grant_type';
  END IF;

  SELECT *
  INTO v_entitlement
  FROM public.creator_entitlements
  WHERE user_id = p_target_user_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_reused_existing := true;
    UPDATE public.creator_entitlements
    SET
      status = 'active',
      grant_type = p_grant_type,
      amount_total_jpy = 0,
      admin_note = nullif(p_note, ''),
      activated_at = COALESCE(activated_at, now()),
      transferred_at = CASE WHEN p_grant_type = 'transferred' THEN now() ELSE transferred_at END,
      revoked_at = null,
      granted_by_user_id = COALESCE(granted_by_user_id, auth.uid()),
      updated_by_user_id = auth.uid(),
      updated_at = now()
    WHERE id = v_entitlement.id
    RETURNING * INTO v_entitlement;
  ELSE
    INSERT INTO public.creator_entitlements (
      id,
      user_id,
      status,
      grant_type,
      amount_total_jpy,
      admin_note,
      granted_by_user_id,
      updated_by_user_id,
      activated_at
    )
    VALUES (
      gen_random_uuid(),
      p_target_user_id,
      'active',
      p_grant_type,
      0,
      nullif(p_note, ''),
      auth.uid(),
      auth.uid(),
      now()
    )
    RETURNING * INTO v_entitlement;
  END IF;

  RETURN QUERY
  SELECT
    v_entitlement.id,
    v_entitlement.user_id,
    v_entitlement.status,
    v_entitlement.grant_type,
    v_reused_existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_creator_entitlement_admin(
  p_target_user_id uuid,
  p_note text DEFAULT null
)
RETURNS TABLE (
  entitlement_id uuid,
  user_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement public.creator_entitlements%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin_me() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT *
  INTO v_entitlement
  FROM public.creator_entitlements
  WHERE user_id = p_target_user_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement not found';
  END IF;

  UPDATE public.creator_entitlements
  SET
    status = 'revoked',
    admin_note = nullif(p_note, ''),
    revoked_at = now(),
    updated_by_user_id = auth.uid(),
    updated_at = now()
  WHERE id = v_entitlement.id
  RETURNING * INTO v_entitlement;

  RETURN QUERY
  SELECT v_entitlement.id, v_entitlement.user_id, v_entitlement.status;
END;
$$;

DROP POLICY IF EXISTS platform_billing_settings_select_authenticated ON public.platform_billing_settings;
DROP POLICY IF EXISTS platform_billing_settings_select_platform_admin ON public.platform_billing_settings;
CREATE POLICY platform_billing_settings_select_platform_admin ON public.platform_billing_settings
  FOR SELECT
  USING (public.is_platform_admin_me());

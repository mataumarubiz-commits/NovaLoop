-- 071_platform_purchase_receipts.sql
-- Platform purchase receipt snapshots, receipt recipient fields, and generic payment event idempotency.

ALTER TABLE public.platform_billing_settings
  ADD COLUMN IF NOT EXISTS qualified_invoice_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_tax_mode text NOT NULL DEFAULT 'exempt'
    CHECK (default_tax_mode IN ('exempt', 'registered_taxable'));

UPDATE public.platform_billing_settings
SET
  qualified_invoice_enabled = CASE
    WHEN invoice_registration_number IS NOT NULL AND btrim(invoice_registration_number) <> '' THEN true
    ELSE COALESCE(qualified_invoice_enabled, false)
  END,
  default_tax_mode = COALESCE(default_tax_mode, 'exempt')
WHERE id = true;

ALTER TABLE public.entitlement_purchase_requests
  ADD COLUMN IF NOT EXISTS receipt_name text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_address text;

UPDATE public.entitlement_purchase_requests
SET
  receipt_name = COALESCE(NULLIF(receipt_name, ''), NULLIF(full_name, '')),
  billing_email = COALESCE(NULLIF(billing_email, ''), NULLIF(contact_email, '')),
  billing_address = COALESCE(NULLIF(billing_address, ''), NULLIF(address, ''))
WHERE receipt_name IS NULL
   OR billing_email IS NULL
   OR billing_address IS NULL;

ALTER TABLE public.platform_payment_requests
  ADD COLUMN IF NOT EXISTS receipt_name text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_address text;

UPDATE public.platform_payment_requests pay
SET
  receipt_name = COALESCE(pay.receipt_name, pr.receipt_name, pr.full_name),
  billing_email = COALESCE(pay.billing_email, pr.billing_email, pr.contact_email),
  billing_address = COALESCE(pay.billing_address, pr.billing_address, pr.address)
FROM public.entitlement_purchase_requests pr
WHERE pr.id = pay.purchase_request_id
  AND (
    pay.receipt_name IS NULL
    OR pay.billing_email IS NULL
    OR pay.billing_address IS NULL
  );

CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.platform_payment_requests(id) ON DELETE RESTRICT,
  purchase_request_id uuid REFERENCES public.entitlement_purchase_requests(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  purchaser_company_name text,
  purchaser_name text NOT NULL,
  purchaser_email text,
  purchaser_address text,
  currency text NOT NULL DEFAULT 'JPY',
  subtotal_amount numeric(12,0) NOT NULL DEFAULT 0,
  tax_amount numeric(12,0) NOT NULL DEFAULT 0,
  total_amount numeric(12,0) NOT NULL DEFAULT 0,
  tax_rate_breakdown_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  paid_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  pdf_path text,
  document_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'void')),
  void_reason text,
  reissued_from_receipt_id uuid REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_receipts_payment_idx
  ON public.purchase_receipts (payment_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_receipts_user_idx
  ON public.purchase_receipts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS purchase_receipts_status_idx
  ON public.purchase_receipts (status, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'platform_manual',
  provider_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payment_request_id uuid REFERENCES public.platform_payment_requests(id) ON DELETE SET NULL,
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_payment_idx
  ON public.payment_webhook_events (payment_request_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.allocate_platform_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_value bigint;
  month_part text := to_char(now() at time zone 'Asia/Tokyo', 'YYYYMM');
BEGIN
  seq_value := nextval('public.platform_receipt_seq');
  RETURN format('RCT-%s-%s', month_part, lpad(seq_value::text, 6, '0'));
END;
$$;

DROP FUNCTION IF EXISTS public.create_platform_purchase_request(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_platform_purchase_request(text, text, text, text, text, text, text, text, text);

CREATE FUNCTION public.create_platform_purchase_request(
  p_full_name text,
  p_company_name text,
  p_address text,
  p_phone text,
  p_contact_email text,
  p_note text,
  p_receipt_name text DEFAULT null,
  p_billing_email text DEFAULT null,
  p_billing_address text DEFAULT null
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
  v_receipt_name text := nullif(btrim(COALESCE(p_receipt_name, p_full_name)), '');
  v_billing_email text := nullif(btrim(COALESCE(p_billing_email, p_contact_email)), '');
  v_billing_address text := nullif(btrim(COALESCE(p_billing_address, p_address)), '');
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
    COALESCE(v_receipt_name, p_full_name),
    nullif(p_company_name, ''),
    COALESCE(v_billing_address, ''),
    p_phone,
    COALESCE(v_billing_email, p_contact_email),
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
      receipt_document_status,
      receipt_name,
      billing_email,
      billing_address
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
      COALESCE(v_billing_address, ''),
      p_phone,
      COALESCE(v_billing_email, p_contact_email),
      v_google_email,
      nullif(p_note, ''),
      COALESCE(v_price, 300000),
      v_issued_at,
      v_due_date,
      'pending_generation',
      'not_requested',
      v_receipt_name,
      v_billing_email,
      v_billing_address
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
      receipt_document_status,
      receipt_name,
      billing_email,
      billing_address
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
      'not_requested',
      v_receipt_name,
      v_billing_email,
      v_billing_address
    );
  ELSE
    UPDATE public.entitlement_purchase_requests
    SET
      full_name = p_full_name,
      company_name = nullif(p_company_name, ''),
      address = COALESCE(v_billing_address, ''),
      phone = p_phone,
      contact_email = COALESCE(v_billing_email, p_contact_email),
      note = nullif(p_note, ''),
      receipt_name = v_receipt_name,
      billing_email = v_billing_email,
      billing_address = v_billing_address,
      updated_at = now()
    WHERE id = v_purchase_id;

    UPDATE public.platform_payment_requests
    SET
      receipt_name = v_receipt_name,
      billing_email = v_billing_email,
      billing_address = v_billing_address,
      updated_at = now()
    WHERE id = v_payment_id;
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

ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_receipts_select_self_or_platform_admin ON public.purchase_receipts;
CREATE POLICY purchase_receipts_select_self_or_platform_admin ON public.purchase_receipts
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS purchase_receipts_admin_write ON public.purchase_receipts;
CREATE POLICY purchase_receipts_admin_write ON public.purchase_receipts
  FOR ALL
  USING (public.is_platform_admin_me())
  WITH CHECK (public.is_platform_admin_me());

DROP POLICY IF EXISTS payment_webhook_events_platform_admin_only ON public.payment_webhook_events;
CREATE POLICY payment_webhook_events_platform_admin_only ON public.payment_webhook_events
  FOR ALL
  USING (public.is_platform_admin_me())
  WITH CHECK (public.is_platform_admin_me());

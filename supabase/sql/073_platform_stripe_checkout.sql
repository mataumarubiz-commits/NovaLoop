-- 073_platform_stripe_checkout.sql
-- Stripe Checkout support for platform-license purchases while preserving
-- auth.uid()-based purchase creation and webhook-driven entitlement activation.

ALTER TABLE public.platform_payment_requests
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_channel text,
  ADD COLUMN IF NOT EXISTS checkout_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_payment_id text;

UPDATE public.platform_payment_requests
SET
  payment_provider = COALESCE(
    payment_provider,
    CASE
      WHEN payment_method = 'bank_transfer' THEN 'manual'
      ELSE 'manual'
    END
  ),
  payment_channel = COALESCE(
    payment_channel,
    CASE
      WHEN payment_method = 'bank_transfer' THEN 'bank_transfer'
      ELSE 'bank_transfer'
    END
  )
WHERE payment_provider IS NULL
   OR payment_channel IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_payment_requests_payment_provider_check'
  ) THEN
    ALTER TABLE public.platform_payment_requests
      ADD CONSTRAINT platform_payment_requests_payment_provider_check
      CHECK (payment_provider IN ('manual', 'stripe'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_payment_requests_payment_channel_check'
  ) THEN
    ALTER TABLE public.platform_payment_requests
      ADD CONSTRAINT platform_payment_requests_payment_channel_check
      CHECK (payment_channel IN ('bank_transfer', 'checkout'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS platform_payment_requests_provider_idx
  ON public.platform_payment_requests (payment_provider, payment_channel, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.platform_payment_requests(id) ON DELETE CASCADE,
  purchase_request_id uuid REFERENCES public.entitlement_purchase_requests(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe')),
  checkout_session_id text NOT NULL UNIQUE,
  payment_intent_id text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'expired', 'canceled')),
  success_url text NOT NULL,
  cancel_url text NOT NULL,
  customer_email text,
  raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_checkout_sessions_payment_idx
  ON public.platform_checkout_sessions (payment_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_checkout_sessions_user_idx
  ON public.platform_checkout_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_checkout_sessions_status_idx
  ON public.platform_checkout_sessions (status, created_at DESC);

ALTER TABLE public.platform_checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_checkout_sessions_select_self_or_platform_admin ON public.platform_checkout_sessions;
CREATE POLICY platform_checkout_sessions_select_self_or_platform_admin ON public.platform_checkout_sessions
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_platform_admin_me());

DROP POLICY IF EXISTS platform_checkout_sessions_admin_write ON public.platform_checkout_sessions;
CREATE POLICY platform_checkout_sessions_admin_write ON public.platform_checkout_sessions
  FOR ALL
  USING (public.is_platform_admin_me())
  WITH CHECK (public.is_platform_admin_me());

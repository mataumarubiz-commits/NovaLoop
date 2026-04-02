-- 070_platform_payment_notify.sql
-- Self-reported bank-transfer notification for platform creator-license purchases.

ALTER TABLE public.platform_payment_requests
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_paid_at_claimed date,
  ADD COLUMN IF NOT EXISTS client_paid_amount_claimed numeric(12,0),
  ADD COLUMN IF NOT EXISTS client_transfer_name text,
  ADD COLUMN IF NOT EXISTS client_notify_note text;

CREATE INDEX IF NOT EXISTS idx_platform_payment_requests_client_notified_at
  ON public.platform_payment_requests (client_notified_at DESC);

COMMENT ON COLUMN public.platform_payment_requests.client_notified_at IS
  '購入者が pending-payment 画面から振込完了を連絡した時刻';

COMMENT ON COLUMN public.platform_payment_requests.client_paid_at_claimed IS
  '購入者申告の振込日';

COMMENT ON COLUMN public.platform_payment_requests.client_paid_amount_claimed IS
  '購入者申告の振込金額';

COMMENT ON COLUMN public.platform_payment_requests.client_transfer_name IS
  '購入者申告の振込名義';

COMMENT ON COLUMN public.platform_payment_requests.client_notify_note IS
  '購入者申告の補足メモ';

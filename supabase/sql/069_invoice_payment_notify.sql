-- 069_invoice_payment_notify.sql (idempotent)
-- 請求書への支払完了通知機能:
-- - invoices に公開トークン・クライアントからの支払通知フィールドを追加
-- - send_prepared_at カラム追加（PDF送付日時追跡用）
-- - 公開ページ用に RLS を考慮した設計

-- ---------------------------------------------------------------------------
-- 1) invoices カラム追加
-- ---------------------------------------------------------------------------

-- 公開URL用トークン（請求書発行時に自動生成）
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_token uuid DEFAULT gen_random_uuid();

-- クライアントからの支払通知（/pay/[public_token] フォームから投稿される）
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_paid_at_claimed date,
  ADD COLUMN IF NOT EXISTS client_paid_amount_claimed numeric(12,2),
  ADD COLUMN IF NOT EXISTS client_transfer_name text,
  ADD COLUMN IF NOT EXISTS client_notify_note text;

-- PDF送付追跡
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS send_prepared_at timestamptz;

-- public_token にユニーク制約とインデックス
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token
  ON public.invoices (public_token)
  WHERE public_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) 既存レコードへの public_token バックフィル
--    （既存 NULL レコードに gen_random_uuid() を付与）
-- ---------------------------------------------------------------------------
UPDATE public.invoices
  SET public_token = gen_random_uuid()
  WHERE public_token IS NULL;

-- ---------------------------------------------------------------------------
-- 3) public_token によるレコード取得用の RLS-safe なビュー
--    クライアントが /pay/[token] で最小限の情報だけ参照できるよう、
--    API 側でサービスロールを使う設計のため RLS 追加は不要。
--    （Supabase Edge Function / Next.js API Route から service role で取得）
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.invoices.public_token IS
  '支払完了通知ページ /pay/{token} 用の公開トークン。URL から推測不可なUUID。';

COMMENT ON COLUMN public.invoices.client_notified_at IS
  'クライアントが支払完了通知フォームを送信した日時。NULL = 未通知。';

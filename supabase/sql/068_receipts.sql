-- 068_receipts.sql (idempotent)
-- 領収書機能: 入金記録・領収書テーブル・採番・RLS・監査

-- ---------------------------------------------------------------------------
-- 1) org_settings: 税区分・領収書採番カラム追加
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'exempt'
    CHECK (tax_mode IN ('exempt', 'registered_taxable')),
  ADD COLUMN IF NOT EXISTS receipt_seq bigint NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2) invoices: 入金ステータスカラム追加
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid')),
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'other')),
  ADD COLUMN IF NOT EXISTS payment_memo text,
  ADD COLUMN IF NOT EXISTS payment_note text;

-- latest_receipt_id は receipts テーブル作成後に追加するため後段で定義

-- ---------------------------------------------------------------------------
-- 3) receipts テーブル
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  invoice_id          uuid        REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_number      text        NOT NULL,
  title               text        NOT NULL DEFAULT '',
  issue_date          date        NOT NULL,
  paid_at             date        NOT NULL,
  payment_method      text        NOT NULL
    CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'other')),
  payer_note          text,
  recipient_name      text        NOT NULL,
  subtotal_amount     numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount          numeric(12,2) NOT NULL DEFAULT 0,
  total_amount        numeric(12,2) NOT NULL DEFAULT 0,
  tax_breakdown_json  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  tax_mode            text        NOT NULL DEFAULT 'exempt'
    CHECK (tax_mode IN ('exempt', 'registered_taxable')),
  issuer_snapshot     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  note                text,
  pdf_path            text,
  status              text        NOT NULL DEFAULT 'issued'
    CHECK (status IN ('draft', 'issued', 'void')),
  void_reason         text,
  voided_at           timestamptz,
  is_reissue          boolean     NOT NULL DEFAULT false,
  reissued_from_id    uuid        REFERENCES public.receipts(id) ON DELETE SET NULL,
  created_by_user_id  uuid        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_receipts_org_created
  ON public.receipts (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipts_invoice
  ON public.receipts (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_org_status
  ON public.receipts (org_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4) receipt_lines テーブル
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_lines (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id      uuid          NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  description     text          NOT NULL,
  quantity        numeric(10,2) NOT NULL DEFAULT 1,
  unit_price      numeric(12,2) NOT NULL DEFAULT 0,
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate        numeric(5,2),
  tax_amount      numeric(12,2),
  invoice_line_id uuid          REFERENCES public.invoice_lines(id) ON DELETE SET NULL,
  sort_order      int           NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_receipt_lines_receipt
  ON public.receipt_lines (receipt_id, sort_order);

-- ---------------------------------------------------------------------------
-- 5) invoices: latest_receipt_id FK（receipts 作成後）
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS latest_receipt_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_invoices_latest_receipt'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT fk_invoices_latest_receipt
        FOREIGN KEY (latest_receipt_id)
        REFERENCES public.receipts(id)
        ON DELETE SET NULL
        NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) RLS: receipts
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_select_admin ON public.receipts;
CREATE POLICY receipts_select_admin ON public.receipts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = receipts.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS receipts_admin_write ON public.receipts;
CREATE POLICY receipts_admin_write ON public.receipts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = receipts.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = receipts.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

-- ---------------------------------------------------------------------------
-- 7) RLS: receipt_lines（receipts 経由）
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipt_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_lines_select_admin ON public.receipt_lines;
CREATE POLICY receipt_lines_select_admin ON public.receipt_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      JOIN public.app_users au ON au.org_id = r.org_id
      WHERE r.id = receipt_lines.receipt_id
        AND au.user_id = auth.uid()
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS receipt_lines_admin_write ON public.receipt_lines;
CREATE POLICY receipt_lines_admin_write ON public.receipt_lines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      JOIN public.app_users au ON au.org_id = r.org_id
      WHERE r.id = receipt_lines.receipt_id
        AND au.user_id = auth.uid()
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.receipts r
      JOIN public.app_users au ON au.org_id = r.org_id
      WHERE r.id = receipt_lines.receipt_id
        AND au.user_id = auth.uid()
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

-- ---------------------------------------------------------------------------
-- 8) 領収書番号採番関数（org_id ごとに R-YYYY-000001 形式）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_receipt_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq  bigint;
  v_year text;
BEGIN
  -- org_settings が存在しない場合は INSERT してから採番
  INSERT INTO public.org_settings (org_id, receipt_seq)
    VALUES (p_org_id, 0)
    ON CONFLICT (org_id) DO NOTHING;

  UPDATE public.org_settings
    SET receipt_seq = receipt_seq + 1
    WHERE org_id = p_org_id
    RETURNING receipt_seq INTO v_seq;

  v_year := to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY');
  RETURN 'R-' || v_year || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- 9) Storage バケット: receipts（invoices バケットに格納）
--    invoices バケットは 003_pdf_storage.sql で作成済み
--    receipt PDFは invoices バケット内 receipts/{org_id}/{yyyy-mm}/ に保存
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.receipts IS
  '領収書。status: draft=下書き / issued=発行済（不変） / void=取消。入金確認後にのみ発行可能。';

COMMENT ON TABLE public.receipt_lines IS
  '領収書明細。receipts.id に紐づく。invoice_lines から複製して保持。';

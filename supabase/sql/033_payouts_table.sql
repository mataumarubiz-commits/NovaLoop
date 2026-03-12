-- 033_payouts_table.sql (idempotent)
-- 支払い記録用 payouts テーブル。Import/Export で復元可能。
-- /payouts は現状 vendor_invoices を参照するが、payouts があればこちらを優先する想定（将来対応）。

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  vendor_invoice_id uuid REFERENCES public.vendor_invoices(id) ON DELETE SET NULL,
  pay_date date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid')),
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_org ON public.payouts (org_id);
CREATE INDEX IF NOT EXISTS idx_payouts_vendor ON public.payouts (vendor_id);
CREATE INDEX IF NOT EXISTS idx_payouts_pay_date ON public.payouts (pay_date);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payouts_admin ON public.payouts;
CREATE POLICY payouts_admin ON public.payouts
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

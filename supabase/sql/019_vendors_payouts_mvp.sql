-- 019_vendors_payouts_mvp.sql (idempotent)
-- 外注支払い MVP: vendors, vendor_invoices, vendor_invoice_lines, content_vendor_assignments
-- RLS: owner / executive_assistant のみ操作可（user_role_in_org 使用）

-- A) vendors
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendors_org ON public.vendors (org_id);

-- B) vendor_invoices
CREATE TABLE IF NOT EXISTS public.vendor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  billing_month text NOT NULL CHECK (billing_month ~ '^\d{4}-\d{2}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
  submit_deadline date NOT NULL,
  pay_date date NOT NULL,
  total numeric(12,2) NOT NULL DEFAULT 0,
  pdf_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_org ON public.vendor_invoices (org_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_vendor ON public.vendor_invoices (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_pay_date ON public.vendor_invoices (pay_date);

-- C) vendor_invoice_lines
CREATE TABLE IF NOT EXISTS public.vendor_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE SET NULL,
  work_type text,
  description text,
  qty int NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoice_lines_invoice ON public.vendor_invoice_lines (vendor_invoice_id);

-- D) content_vendor_assignments (content と vendor の紐付け・単価オーバーライド)
CREATE TABLE IF NOT EXISTS public.content_vendor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor',
  unit_price_override numeric(12,2),
  created_at timestamptz DEFAULT now(),
  UNIQUE (content_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_content_vendor_assignments_org ON public.content_vendor_assignments (org_id);

-- RLS (018 の user_role_in_org を利用。018 が未実行の場合は先に実行すること)
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_vendor_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_admin ON public.vendors;
CREATE POLICY vendors_admin ON public.vendors
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS vendor_invoices_admin ON public.vendor_invoices;
CREATE POLICY vendor_invoices_admin ON public.vendor_invoices
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS vendor_invoice_lines_admin ON public.vendor_invoice_lines;
CREATE POLICY vendor_invoice_lines_admin ON public.vendor_invoice_lines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_invoices vi
      WHERE vi.id = vendor_invoice_lines.vendor_invoice_id
        AND public.user_role_in_org(vi.org_id) IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendor_invoices vi
      WHERE vi.id = vendor_invoice_lines.vendor_invoice_id
        AND public.user_role_in_org(vi.org_id) IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS content_vendor_assignments_admin ON public.content_vendor_assignments;
CREATE POLICY content_vendor_assignments_admin ON public.content_vendor_assignments
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

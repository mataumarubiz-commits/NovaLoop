-- 058_vendor_submission_links.sql
-- 外注向け請求提出URLフロー

-- =============================================
-- 1. vendor_submission_links: トークン付き提出URL管理
-- =============================================
CREATE TABLE IF NOT EXISTS public.vendor_submission_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  target_month text NOT NULL CHECK (target_month ~ '^\d{4}-\d{2}$'),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  allow_resubmission boolean NOT NULL DEFAULT false,
  custom_message text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsl_token ON public.vendor_submission_links(token);
CREATE INDEX IF NOT EXISTS idx_vsl_org_vendor ON public.vendor_submission_links(org_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_vsl_org_month ON public.vendor_submission_links(org_id, target_month);

-- =============================================
-- 2. vendor_invoices に submission_link_id を追加
-- =============================================
ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submission_link_id uuid REFERENCES public.vendor_submission_links(id);

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submitter_name text;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submitter_email text;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submitter_bank_json jsonb;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submitter_notes text;

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submission_count int NOT NULL DEFAULT 0;

-- =============================================
-- 3. RLS: vendor_submission_links
-- =============================================
ALTER TABLE public.vendor_submission_links ENABLE ROW LEVEL SECURITY;

-- Admin can manage all links in their org
DROP POLICY IF EXISTS vsl_admin_all ON public.vendor_submission_links;
CREATE POLICY vsl_admin_all ON public.vendor_submission_links
  FOR ALL
  USING (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
  );

-- updated_at trigger
CREATE OR REPLACE TRIGGER set_vsl_updated_at
  BEFORE UPDATE ON public.vendor_submission_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

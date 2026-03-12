-- 027_vendor_portal.sql (idempotent)
-- 外注ポータルMVP: vendor_users 紐付けと vendor_invoices 提出日時・RLS 拡張

-- A) vendor_users: Supabase Auth user と vendor の紐付け
CREATE TABLE IF NOT EXISTS public.vendor_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (org_id, vendor_id),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_users_org ON public.vendor_users (org_id);
CREATE INDEX IF NOT EXISTS idx_vendor_users_vendor ON public.vendor_users (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_users_user ON public.vendor_users (user_id);

ALTER TABLE public.vendor_users ENABLE ROW LEVEL SECURITY;

-- vendor_users: 自分 or owner/assistant が参照可、書き込みは owner/assistant のみ
DROP POLICY IF EXISTS vendor_users_select_self_or_admin ON public.vendor_users;
CREATE POLICY vendor_users_select_self_or_admin ON public.vendor_users
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.user_role_in_org(org_id) IN ('owner','executive_assistant')
  );

DROP POLICY IF EXISTS vendor_users_admin_write ON public.vendor_users;
CREATE POLICY vendor_users_admin_write ON public.vendor_users
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner','executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner','executive_assistant'));

-- B) vendor_invoices: 提出日時
ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- C) vendor_invoices / vendor_invoice_lines RLS 拡張
--    owner/executive_assistant: 既存ポリシー (019) を維持
--    vendor ユーザー: vendor_users 経由で自分の vendor 分のみアクセス可

-- vendor 用 SELECT: 自分の vendor_id + org_id に紐づく請求のみ
DROP POLICY IF EXISTS vendor_invoices_vendor_select ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_select ON public.vendor_invoices
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

-- vendor 用 INSERT: 自分の vendor_id/org_id のみ作成可
DROP POLICY IF EXISTS vendor_invoices_vendor_insert ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_insert ON public.vendor_invoices
  FOR INSERT
  WITH CHECK (
    status IN ('draft','submitted')
    AND EXISTS (
      SELECT 1 FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

-- vendor 用 UPDATE: draft/submitted の間のみ更新可（approved/paid は不可）
DROP POLICY IF EXISTS vendor_invoices_vendor_update ON public.vendor_invoices;
CREATE POLICY vendor_invoices_vendor_update ON public.vendor_invoices
  FOR UPDATE
  USING (
    status IN ('draft','submitted')
    AND EXISTS (
      SELECT 1 FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('draft','submitted','approved','paid')
    AND EXISTS (
      SELECT 1 FROM public.vendor_users vu
      WHERE vu.vendor_id = public.vendor_invoices.vendor_id
        AND vu.org_id = public.vendor_invoices.org_id
        AND vu.user_id = auth.uid()
    )
  );

-- vendor_invoice_lines: vendor 側の select/insert/update を許可（親請求の RLS を経由）
DROP POLICY IF EXISTS vendor_invoice_lines_vendor ON public.vendor_invoice_lines;
CREATE POLICY vendor_invoice_lines_vendor ON public.vendor_invoice_lines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft','submitted')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.vendor_invoices vi
      JOIN public.vendor_users vu
        ON vu.vendor_id = vi.vendor_id
       AND vu.org_id = vi.org_id
       AND vu.user_id = auth.uid()
      WHERE vi.id = public.vendor_invoice_lines.vendor_invoice_id
        AND vi.status IN ('draft','submitted')
    )
  );


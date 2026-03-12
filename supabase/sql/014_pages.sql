-- 014_pages.sql (idempotent)
-- org 内ドキュメント用 Pages テーブルと RLS

CREATE TABLE IF NOT EXISTS public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '無題',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_archived boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS pages_org_updated_idx
  ON public.pages (org_id, updated_at DESC);

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

-- org メンバーは閲覧可能
DROP POLICY IF EXISTS pages_select_org_members ON public.pages;
CREATE POLICY pages_select_org_members ON public.pages
  FOR SELECT
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = public.pages.org_id
    )
  );

-- owner / executive_assistant のみ作成・更新・削除可能
DROP POLICY IF EXISTS pages_write_admin ON public.pages;
CREATE POLICY pages_write_admin ON public.pages
  FOR ALL
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = public.pages.org_id
        and au.role in ('owner','executive_assistant')
    )
  )
  WITH CHECK (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = public.pages.org_id
        and au.role in ('owner','executive_assistant')
    )
  );


-- 038_page_revisions.sql (idempotent)
-- ページ更新履歴（全文スナップショット）。復元用。

CREATE TABLE IF NOT EXISTS public.page_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  title text NOT NULL,
  body_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_revisions_page_created_idx
  ON public.page_revisions (page_id, created_at DESC);

ALTER TABLE public.page_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS page_revisions_select_org_members ON public.page_revisions;
CREATE POLICY page_revisions_select_org_members ON public.page_revisions
  FOR SELECT
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.page_revisions.org_id
    )
  );

-- 挿入は API（service role）経由で PATCH 時に記録。RLS では owner/executive_assistant のみ
DROP POLICY IF EXISTS page_revisions_insert_admin ON public.page_revisions;
CREATE POLICY page_revisions_insert_admin ON public.page_revisions
  FOR INSERT
  WITH CHECK (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.page_revisions.org_id
        and au.role in ('owner','executive_assistant')
    )
  );

COMMENT ON TABLE public.page_revisions IS 'ページ更新履歴。保存時にスナップショットを追加。復元は page を上書き。';

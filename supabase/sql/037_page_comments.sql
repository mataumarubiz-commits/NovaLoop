-- 037_page_comments.sql (idempotent)
-- ページ単位コメント。将来は selection_range 等で選択範囲コメントへ拡張可能。

CREATE TABLE IF NOT EXISTS public.page_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS page_comments_page_id_idx
  ON public.page_comments (page_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS page_comments_org_created_idx
  ON public.page_comments (org_id, created_at DESC);

ALTER TABLE public.page_comments ENABLE ROW LEVEL SECURITY;

-- org メンバーは同一 org のコメントを閲覧
DROP POLICY IF EXISTS page_comments_select_org_members ON public.page_comments;
CREATE POLICY page_comments_select_org_members ON public.page_comments
  FOR SELECT
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.page_comments.org_id
    )
  );

-- メンバーはコメント追加可（閲覧のみでもコメントは許可するかは要件次第。ここでは org メンバー全員が追加可）
DROP POLICY IF EXISTS page_comments_insert_org_members ON public.page_comments;
CREATE POLICY page_comments_insert_org_members ON public.page_comments
  FOR INSERT
  WITH CHECK (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.page_comments.org_id
    )
  );

-- 更新は soft delete（deleted_at 設定）のみ。本人または owner/executive_assistant が削除可
DROP POLICY IF EXISTS page_comments_update_self_or_admin ON public.page_comments;
CREATE POLICY page_comments_update_self_or_admin ON public.page_comments
  FOR UPDATE
  USING (
    auth.uid() = user_id
    or exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid() and au.org_id = public.page_comments.org_id
        and au.role in ('owner','executive_assistant')
    )
  )
  WITH CHECK (true);

COMMENT ON COLUMN public.page_comments.deleted_at IS 'soft delete。NULL で有効。';

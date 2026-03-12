-- 013_app_users_members_visibility.sql (idempotent)
-- app_users の SELECT を「同一 org のメンバー全員が閲覧可」に変更する。
-- これにより /members でオーナー以外も全メンバー一覧を参照できる。

DROP POLICY IF EXISTS app_users_select_self_or_admin ON public.app_users;

CREATE POLICY app_users_select_org_members ON public.app_users
  FOR SELECT
  USING (
    exists (
      select 1 from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = public.app_users.org_id
    )
  );


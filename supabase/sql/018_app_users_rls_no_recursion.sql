-- 018_app_users_rls_no_recursion.sql (idempotent)
-- app_users の RLS で自身を参照すると無限再帰するため、
-- SECURITY DEFINER のヘルパーで「同一 org メンバーか」「owner/executive_assistant か」を判定する。

-- ---------------------------------------------------------------------------
-- 1) ヘルパー関数（004_storage_policies と同一。未作成時用にここでも定義）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.user_id = auth.uid()
      AND au.org_id = is_org_member.org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_role_in_org(org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.role
  FROM public.app_users au
  WHERE au.user_id = auth.uid()
    AND au.org_id = user_role_in_org.org_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role_in_org(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) app_users のポリシーを再帰なしに差し替え
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS app_users_select_self_or_admin ON public.app_users;
DROP POLICY IF EXISTS app_users_select_org_members ON public.app_users;
DROP POLICY IF EXISTS app_users_admin_write ON public.app_users;
DROP POLICY IF EXISTS app_users_insert_admin ON public.app_users;
DROP POLICY IF EXISTS app_users_update_admin ON public.app_users;
DROP POLICY IF EXISTS app_users_delete_admin ON public.app_users;

-- SELECT: 本人の行 または 同一 org のメンバー（ヘルパーで判定し再帰を避ける）
CREATE POLICY app_users_select_org_members ON public.app_users
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_org_member(org_id)
  );

-- INSERT: その org の owner / executive_assistant のみ
CREATE POLICY app_users_insert_admin ON public.app_users
  FOR INSERT
  WITH CHECK (
    public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
  );

-- UPDATE / DELETE: その org の owner / executive_assistant のみ
CREATE POLICY app_users_update_admin ON public.app_users
  FOR UPDATE
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

CREATE POLICY app_users_delete_admin ON public.app_users
  FOR DELETE
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

-- 012_organizations_owner_update.sql (idempotent)
-- 組織名の更新を owner のみに制限する。SELECT は既存のまま、INSERT は 009 の authenticated。

DROP POLICY IF EXISTS organizations_admin_write ON public.organizations;

CREATE POLICY organizations_update_owner ON public.organizations
  FOR UPDATE
  USING (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = organizations.id
        and au.role = 'owner'
    )
  )
  WITH CHECK (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = organizations.id
        and au.role = 'owner'
    )
  );

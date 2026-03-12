-- 004_rls_mvp1_patch.sql
-- MVP1要件に沿うRLSパッチ。既存ポリシーと衝突する場合は drop policy if exists で削除してから再作成する。
-- 要件:
--   contents: orgメンバーは select/insert/update 可
--   clients: selectはorgメンバー可、insert/updateは owner/executive_assistant のみ
--   app_users: 本人はselect可、owner/executive_assistantは同一orgのapp_usersをselect可

-- ---------------------------------------------------------------------------
-- contents: orgメンバー（app_usersで org_id 一致する user）は select/insert/update 可
-- ---------------------------------------------------------------------------
drop policy if exists contents_select_org_members on contents;
drop policy if exists contents_write_org_members on contents;
drop policy if exists contents_update_org_members on contents;
drop policy if exists contents_delete_org_members on contents;

create policy contents_select_org_members
  on contents
  for select
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = contents.org_id
    )
  );

create policy contents_insert_org_members
  on contents
  for insert
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = contents.org_id
    )
  );

create policy contents_update_org_members
  on contents
  for update
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = contents.org_id
    )
  )
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = contents.org_id
    )
  );

create policy contents_delete_org_members
  on contents
  for delete
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = contents.org_id
    )
  );

-- ---------------------------------------------------------------------------
-- clients: selectはorgメンバー可、insert/updateは owner/executive_assistant のみ
-- ---------------------------------------------------------------------------
drop policy if exists clients_select_org_members on clients;
drop policy if exists clients_admin_write on clients;

create policy clients_select_org_members
  on clients
  for select
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.org_id = clients.org_id
    )
  );

create policy clients_insert_admin
  on clients
  for insert
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = clients.org_id
    )
  );

create policy clients_update_admin
  on clients
  for update
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = clients.org_id
    )
  )
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = clients.org_id
    )
  );

create policy clients_delete_admin
  on clients
  for delete
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = clients.org_id
    )
  );

-- ---------------------------------------------------------------------------
-- app_users: 本人はselect可、owner/executive_assistantは同一orgのapp_usersをselect可
-- ---------------------------------------------------------------------------
drop policy if exists app_users_select_self_or_admin on app_users;
drop policy if exists app_users_admin_write on app_users;

create policy app_users_select_self_or_admin
  on app_users
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

create policy app_users_insert_admin
  on app_users
  for insert
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

create policy app_users_update_admin
  on app_users
  for update
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = app_users.org_id
    )
  )
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

create policy app_users_delete_admin
  on app_users
  for delete
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

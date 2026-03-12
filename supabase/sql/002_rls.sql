-- 002_rls.sql

-- Enable RLS
alter table organizations enable row level security;
alter table app_users enable row level security;
alter table clients enable row level security;
alter table org_settings enable row level security;
alter table contents enable row level security;
alter table content_assignments enable row level security;
alter table status_events enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table vault_files enable row level security;
alter table vault_events enable row level security;

-- organizations
create policy organizations_select_org_members
  on organizations
  for select
  using (id = (select org_id from app_users where user_id = auth.uid()));

create policy organizations_admin_write
  on organizations
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = organizations.id
    )
  )
  with check (
    id = (select org_id from app_users where user_id = auth.uid())
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = organizations.id
    )
  );

-- app_users
create policy app_users_select_self_or_admin
  on app_users
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

create policy app_users_admin_write
  on app_users
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = app_users.org_id
    )
  )
  with check (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = app_users.org_id
    )
  );

-- clients
create policy clients_select_org_members
  on clients
  for select
  using (org_id = (select org_id from app_users where user_id = auth.uid()));

create policy clients_admin_write
  on clients
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = clients.org_id
    )
  )
  with check (
    org_id = (select org_id from app_users where user_id = auth.uid())
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = clients.org_id
    )
  );

-- org_settings
create policy org_settings_select_org_members
  on org_settings
  for select
  using (org_id = (select org_id from app_users where user_id = auth.uid()));

create policy org_settings_admin_write
  on org_settings
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = org_settings.org_id
    )
  )
  with check (
    org_id = (select org_id from app_users where user_id = auth.uid())
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = org_settings.org_id
    )
  );

-- contents
create policy contents_select_org_members
  on contents
  for select
  using (org_id = (select org_id from app_users where user_id = auth.uid()));

create policy contents_write_org_members
  on contents
  for insert
  with check (org_id = (select org_id from app_users where user_id = auth.uid()));

create policy contents_update_org_members
  on contents
  for update
  using (org_id = (select org_id from app_users where user_id = auth.uid()))
  with check (org_id = (select org_id from app_users where user_id = auth.uid()));

create policy contents_delete_org_members
  on contents
  for delete
  using (org_id = (select org_id from app_users where user_id = auth.uid()));

-- content_assignments (same access as contents)
create policy content_assignments_select_org_members
  on content_assignments
  for select
  using (
    exists (
      select 1 from contents c
      where c.id = content_assignments.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy content_assignments_write_org_members
  on content_assignments
  for insert
  with check (
    exists (
      select 1 from contents c
      where c.id = content_assignments.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy content_assignments_update_org_members
  on content_assignments
  for update
  using (
    exists (
      select 1 from contents c
      where c.id = content_assignments.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from contents c
      where c.id = content_assignments.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy content_assignments_delete_org_members
  on content_assignments
  for delete
  using (
    exists (
      select 1 from contents c
      where c.id = content_assignments.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

-- status_events (same access as contents)
create policy status_events_select_org_members
  on status_events
  for select
  using (
    exists (
      select 1 from contents c
      where c.id = status_events.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy status_events_write_org_members
  on status_events
  for insert
  with check (
    exists (
      select 1 from contents c
      where c.id = status_events.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy status_events_update_org_members
  on status_events
  for update
  using (
    exists (
      select 1 from contents c
      where c.id = status_events.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from contents c
      where c.id = status_events.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

create policy status_events_delete_org_members
  on status_events
  for delete
  using (
    exists (
      select 1 from contents c
      where c.id = status_events.content_id
        and c.org_id = (select org_id from app_users where user_id = auth.uid())
    )
  );

-- invoices (owner/executive_assistant only)
create policy invoices_admin_select
  on invoices
  for select
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = invoices.org_id
    )
  );

create policy invoices_admin_write
  on invoices
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = invoices.org_id
    )
  )
  with check (
    org_id = (select org_id from app_users where user_id = auth.uid())
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = invoices.org_id
    )
  );

-- invoice_lines (owner/executive_assistant only, via invoice org)
create policy invoice_lines_admin_select
  on invoice_lines
  for select
  using (
    exists (
      select 1 from invoices i
      join app_users au on au.org_id = i.org_id
      where i.id = invoice_lines.invoice_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );

create policy invoice_lines_admin_write
  on invoice_lines
  for all
  using (
    exists (
      select 1 from invoices i
      join app_users au on au.org_id = i.org_id
      where i.id = invoice_lines.invoice_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  )
  with check (
    exists (
      select 1 from invoices i
      join app_users au on au.org_id = i.org_id
      where i.id = invoice_lines.invoice_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );

-- vault_files (owner/executive_assistant only)
create policy vault_files_admin_select
  on vault_files
  for select
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = vault_files.org_id
    )
  );

create policy vault_files_admin_write
  on vault_files
  for all
  using (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = vault_files.org_id
    )
  )
  with check (
    org_id = (select org_id from app_users where user_id = auth.uid())
    and exists (
      select 1 from app_users au
      where au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
        and au.org_id = vault_files.org_id
    )
  );

-- vault_events (owner/executive_assistant only via vault_files)
create policy vault_events_admin_select
  on vault_events
  for select
  using (
    exists (
      select 1 from vault_files vf
      join app_users au on au.org_id = vf.org_id
      where vf.id = vault_events.vault_file_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );

create policy vault_events_admin_write
  on vault_events
  for all
  using (
    exists (
      select 1 from vault_files vf
      join app_users au on au.org_id = vf.org_id
      where vf.id = vault_events.vault_file_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  )
  with check (
    exists (
      select 1 from vault_files vf
      join app_users au on au.org_id = vf.org_id
      where vf.id = vault_events.vault_file_id
        and au.user_id = auth.uid()
        and au.role in ('owner','executive_assistant')
    )
  );
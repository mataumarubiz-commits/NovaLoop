-- 057_work_items_beta.sql
-- Lycollection beta: extend contents into generic billable work items without breaking delivery_month billing.

create table if not exists public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  service_category text not null,
  statuses_json jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create index if not exists workflow_templates_org_category_idx
  on public.workflow_templates (org_id, service_category, is_default desc, key);

create table if not exists public.service_catalogs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  service_category text not null,
  billing_model text not null,
  unit_type text not null,
  default_unit_price integer not null default 0,
  default_quantity numeric(12,2) not null default 1,
  workflow_template_key text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists service_catalogs_org_active_idx
  on public.service_catalogs (org_id, is_active, service_category, sort_order, name);

alter table public.contents
  add column if not exists service_name text,
  add column if not exists service_category text,
  add column if not exists billing_model text,
  add column if not exists unit_type text,
  add column if not exists quantity numeric(12,2) not null default 1,
  add column if not exists service_catalog_id uuid,
  add column if not exists workflow_template_key text,
  add column if not exists status_group text,
  add column if not exists started_at date,
  add column if not exists delivered_at date,
  add column if not exists approved_at date,
  add column if not exists external_ref text,
  add column if not exists metadata_json jsonb not null default '{}'::jsonb,
  add column if not exists influencer_count integer,
  add column if not exists post_date date,
  add column if not exists launch_date date,
  add column if not exists report_due_at date,
  add column if not exists deliverable_type text;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contents'
      and column_name = 'amount'
  ) then
    execute '
      alter table public.contents
      add column amount numeric(12,2)
      generated always as ((quantity * unit_price)::numeric(12,2)) stored
    ';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contents'
      and column_name = 'target_month'
  ) then
    execute '
      alter table public.contents
      add column target_month text
      generated always as (delivery_month) stored
    ';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contents_service_catalog_id_fkey'
  ) then
    alter table public.contents
      add constraint contents_service_catalog_id_fkey
      foreign key (service_catalog_id) references public.service_catalogs(id) on delete set null;
  end if;
end $$;

create index if not exists contents_work_items_billing_idx
  on public.contents (org_id, delivery_month, service_category, billing_model, invoice_id);

create index if not exists contents_service_catalog_idx
  on public.contents (org_id, service_catalog_id, workflow_template_key);

create index if not exists contents_external_ref_idx
  on public.contents (org_id, external_ref);

do $$
begin
  begin
    alter table public.invoice_lines
      alter column quantity type numeric(12,2)
      using quantity::numeric(12,2);
  exception
    when others then
      null;
  end;
end $$;

update public.contents
set
  service_name = coalesce(nullif(service_name, ''), title),
  service_category = coalesce(nullif(service_category, ''), 'video_editing'),
  billing_model = coalesce(nullif(billing_model, ''), 'per_unit'),
  unit_type = coalesce(nullif(unit_type, ''), 'video'),
  workflow_template_key = coalesce(nullif(workflow_template_key, ''), 'video_editing'),
  status_group = coalesce(nullif(status_group, ''), 'video')
where
  service_name is null
  or service_category is null
  or billing_model is null
  or unit_type is null
  or workflow_template_key is null
  or status_group is null;

alter table public.workflow_templates enable row level security;
alter table public.service_catalogs enable row level security;

drop policy if exists workflow_templates_select_org_members on public.workflow_templates;
drop policy if exists workflow_templates_admin_write on public.workflow_templates;
create policy workflow_templates_select_org_members
  on public.workflow_templates
  for select
  using (public.is_org_member(org_id));
create policy workflow_templates_admin_write
  on public.workflow_templates
  for all
  using (public.user_role_in_org(org_id) in ('owner', 'executive_assistant'))
  with check (public.user_role_in_org(org_id) in ('owner', 'executive_assistant'));

drop policy if exists service_catalogs_select_org_members on public.service_catalogs;
drop policy if exists service_catalogs_admin_write on public.service_catalogs;
create policy service_catalogs_select_org_members
  on public.service_catalogs
  for select
  using (public.is_org_member(org_id));
create policy service_catalogs_admin_write
  on public.service_catalogs
  for all
  using (public.user_role_in_org(org_id) in ('owner', 'executive_assistant'))
  with check (public.user_role_in_org(org_id) in ('owner', 'executive_assistant'));

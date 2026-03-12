-- 053_external_ai_channels.sql
-- Read-only external AI chat integration for Discord / LINE

create table if not exists public.external_channel_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  linked_user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete cascade,
  channel_type text not null check (channel_type in ('discord', 'line')),
  external_user_id text,
  external_display_name text,
  role text not null check (role in ('owner', 'executive_assistant', 'member', 'vendor')),
  status text not null default 'pending' check (status in ('pending', 'linked', 'revoked')),
  link_code text,
  code_expires_at timestamptz,
  verified_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists external_channel_links_user_channel_idx
  on public.external_channel_links (org_id, linked_user_id, channel_type);

create unique index if not exists external_channel_links_channel_external_idx
  on public.external_channel_links (channel_type, external_user_id)
  where external_user_id is not null;

create unique index if not exists external_channel_links_link_code_idx
  on public.external_channel_links (channel_type, link_code)
  where link_code is not null;

create index if not exists external_channel_links_org_status_idx
  on public.external_channel_links (org_id, status, channel_type);

create table if not exists public.ai_channel_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  discord_enabled boolean not null default false,
  line_enabled boolean not null default false,
  discord_bot_label text,
  line_bot_label text,
  open_app_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_chat_audit_logs (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('discord', 'line', 'internal')),
  external_user_id text,
  linked_user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete set null,
  role text check (role in ('owner', 'executive_assistant', 'member', 'vendor')),
  vendor_id uuid references public.vendors(id) on delete set null,
  user_message text not null,
  selected_tools jsonb not null default '[]'::jsonb,
  tool_result_summary jsonb not null default '{}'::jsonb,
  ai_response text,
  status text not null default 'completed' check (status in ('completed', 'denied', 'unlinked', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_audit_logs_org_created_idx
  on public.ai_chat_audit_logs (org_id, created_at desc);

create index if not exists ai_chat_audit_logs_channel_created_idx
  on public.ai_chat_audit_logs (channel_type, created_at desc);

alter table public.external_channel_links enable row level security;
alter table public.ai_channel_settings enable row level security;
alter table public.ai_chat_audit_logs enable row level security;

drop policy if exists external_channel_links_select_self on public.external_channel_links;
create policy external_channel_links_select_self
  on public.external_channel_links
  for select
  using (linked_user_id = auth.uid());

drop policy if exists ai_channel_settings_select_org_members on public.ai_channel_settings;
create policy ai_channel_settings_select_org_members
  on public.ai_channel_settings
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = ai_channel_settings.org_id
    )
  );

drop policy if exists ai_channel_settings_admin_write on public.ai_channel_settings;
create policy ai_channel_settings_admin_write
  on public.ai_channel_settings
  for all
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = ai_channel_settings.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = ai_channel_settings.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists ai_chat_audit_logs_select_admin on public.ai_chat_audit_logs;
create policy ai_chat_audit_logs_select_admin
  on public.ai_chat_audit_logs
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = ai_chat_audit_logs.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

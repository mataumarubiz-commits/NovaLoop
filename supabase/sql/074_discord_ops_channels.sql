-- 074_discord_ops_channels.sql
-- Discord admin-only fixed-channel operations layer

create table if not exists public.org_discord_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  guild_id text not null,
  guild_name text not null default '',
  channel_id text not null,
  channel_name text not null default '',
  installed_by_user_id uuid references auth.users(id) on delete set null,
  commands_enabled boolean not null default true,
  immediate_notifications_enabled boolean not null default true,
  morning_summary_enabled boolean not null default true,
  evening_summary_enabled boolean not null default true,
  incident_notifications_enabled boolean not null default true,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_healthcheck_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id),
  unique (guild_id)
);

create table if not exists public.discord_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid null references public.notifications(id) on delete set null,
  event_type text not null,
  dedupe_key text not null,
  channel_id text not null,
  discord_message_id text null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, event_type, dedupe_key)
);

create table if not exists public.discord_notification_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  enabled boolean not null default true,
  delivery_mode text not null default 'both' check (delivery_mode in ('immediate', 'summary', 'both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, event_type)
);

create table if not exists public.discord_command_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  interaction_id text not null unique,
  discord_guild_id text not null,
  discord_channel_id text not null,
  discord_user_id text not null,
  app_user_id uuid null references auth.users(id) on delete set null,
  command_name text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  status text not null default 'success' check (status in ('success', 'failed', 'denied', 'duplicate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_discord_connections_org on public.org_discord_connections(org_id);
create index if not exists idx_discord_notification_rules_org on public.discord_notification_rules(org_id, event_type);
create index if not exists idx_discord_delivery_logs_org_created on public.discord_delivery_logs(org_id, created_at desc);
create index if not exists idx_discord_command_logs_org_created on public.discord_command_logs(org_id, created_at desc);

drop trigger if exists set_org_discord_connections_updated_at on public.org_discord_connections;
create trigger set_org_discord_connections_updated_at
before update on public.org_discord_connections
for each row execute function public.set_updated_at();

drop trigger if exists set_discord_delivery_logs_updated_at on public.discord_delivery_logs;
create trigger set_discord_delivery_logs_updated_at
before update on public.discord_delivery_logs
for each row execute function public.set_updated_at();

drop trigger if exists set_discord_notification_rules_updated_at on public.discord_notification_rules;
create trigger set_discord_notification_rules_updated_at
before update on public.discord_notification_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_discord_command_logs_updated_at on public.discord_command_logs;
create trigger set_discord_command_logs_updated_at
before update on public.discord_command_logs
for each row execute function public.set_updated_at();

alter table public.org_discord_connections enable row level security;
alter table public.discord_notification_rules enable row level security;
alter table public.discord_delivery_logs enable row level security;
alter table public.discord_command_logs enable row level security;

drop policy if exists org_discord_connections_select_admin on public.org_discord_connections;
create policy org_discord_connections_select_admin
  on public.org_discord_connections
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = org_discord_connections.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists org_discord_connections_admin_write on public.org_discord_connections;
create policy org_discord_connections_admin_write
  on public.org_discord_connections
  for all
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = org_discord_connections.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = org_discord_connections.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists discord_delivery_logs_select_admin on public.discord_delivery_logs;
create policy discord_delivery_logs_select_admin
  on public.discord_delivery_logs
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = discord_delivery_logs.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists discord_notification_rules_select_admin on public.discord_notification_rules;
create policy discord_notification_rules_select_admin
  on public.discord_notification_rules
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = discord_notification_rules.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists discord_notification_rules_admin_write on public.discord_notification_rules;
create policy discord_notification_rules_admin_write
  on public.discord_notification_rules
  for all
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = discord_notification_rules.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  )
  with check (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = discord_notification_rules.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists discord_command_logs_select_admin on public.discord_command_logs;
create policy discord_command_logs_select_admin
  on public.discord_command_logs
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.user_id = auth.uid()
        and au.org_id = discord_command_logs.org_id
        and au.role in ('owner', 'executive_assistant')
    )
  );

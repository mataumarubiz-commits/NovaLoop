create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  role text,
  event_name text not null,
  source text,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_org_created_idx
  on public.analytics_events (org_id, created_at desc);

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);

create table if not exists public.onboarding_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  item_key text not null,
  completed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, item_key)
);

create index if not exists onboarding_progress_org_user_idx
  on public.onboarding_progress (org_id, user_id);

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  role text,
  page_path text,
  category text not null,
  message text not null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_submissions_org_created_idx
  on public.feedback_submissions (org_id, created_at desc);

alter table public.analytics_events enable row level security;
alter table public.onboarding_progress enable row level security;
alter table public.feedback_submissions enable row level security;

drop policy if exists analytics_events_select_admin on public.analytics_events;
create policy analytics_events_select_admin
  on public.analytics_events
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.org_id = analytics_events.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists analytics_events_insert_member on public.analytics_events;
create policy analytics_events_insert_member
  on public.analytics_events
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_users au
      where au.org_id = analytics_events.org_id
        and au.user_id = auth.uid()
    )
  );

drop policy if exists onboarding_progress_select_admin on public.onboarding_progress;
create policy onboarding_progress_select_admin
  on public.onboarding_progress
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.org_id = onboarding_progress.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists onboarding_progress_insert_admin on public.onboarding_progress;
create policy onboarding_progress_insert_admin
  on public.onboarding_progress
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_users au
      where au.org_id = onboarding_progress.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists onboarding_progress_update_admin on public.onboarding_progress;
create policy onboarding_progress_update_admin
  on public.onboarding_progress
  for update
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_users au
      where au.org_id = onboarding_progress.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_users au
      where au.org_id = onboarding_progress.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists feedback_submissions_select_admin on public.feedback_submissions;
create policy feedback_submissions_select_admin
  on public.feedback_submissions
  for select
  using (
    exists (
      select 1
      from public.app_users au
      where au.org_id = feedback_submissions.org_id
        and au.user_id = auth.uid()
        and au.role in ('owner', 'executive_assistant')
    )
  );

drop policy if exists feedback_submissions_insert_member on public.feedback_submissions;
create policy feedback_submissions_insert_member
  on public.feedback_submissions
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.app_users au
      where au.org_id = feedback_submissions.org_id
        and au.user_id = auth.uid()
    )
  );

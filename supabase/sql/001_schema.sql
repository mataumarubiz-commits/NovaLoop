-- 001_schema.sql

create table if not exists organizations (
  id uuid primary key,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists app_users (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete restrict,
  user_id uuid not null,
  role text not null check (role in ('owner','executive_assistant','pm','director','worker')),
  created_at timestamptz default now(),
  unique (user_id)
);

create table if not exists clients (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete restrict,
  name text not null,
  client_type text not null check (client_type in ('corporate','individual')),
  created_at timestamptz default now()
);

create table if not exists org_settings (
  org_id uuid primary key references organizations(id) on delete restrict,
  kgi_text text,
  invoice_seq bigint default 1,
  issuer_name text,
  issuer_address text,
  bank_text text
);

create table if not exists invoices (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete restrict,
  client_id uuid not null references clients(id) on delete restrict,
  invoice_month text not null check (invoice_month ~ '^\d{4}-\d{2}$'),
  status text not null check (status in ('draft','issued','void')),
  invoice_no text,
  invoice_title text not null,
  issue_date date not null default current_date,
  due_date date not null,
  subtotal numeric(12,2) not null default 0,
  created_at timestamptz default now(),
  issued_at timestamptz
);

create table if not exists contents (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete restrict,
  client_id uuid not null references clients(id) on delete restrict,
  project_name text not null,
  title text not null,
  unit_price numeric(12,2) not null,
  due_client_at date not null,
  due_editor_at date not null,
  status text not null check (
    status in (
      'not_started',
      'materials_checked',
      'editing',
      'internal_revision',
      'editing_revision',
      'submitted_to_client',
      'client_revision',
      'scheduling',
      'delivered',
      'published',
      'canceled'
    )
  ),
  thumbnail_done boolean not null default false,
  billable_flag boolean not null default true,
  delivery_month text not null check (delivery_month ~ '^\d{4}-\d{2}$'),
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists invoice_lines (
  id uuid primary key,
  invoice_id uuid not null references invoices(id) on delete cascade,
  content_id uuid references contents(id) on delete set null,
  quantity int not null default 1,
  unit_price numeric(12,2) not null,
  amount numeric(12,2) not null,
  description text not null,
  sort_order int not null default 1
);

create table if not exists content_assignments (
  id uuid primary key,
  content_id uuid not null references contents(id) on delete cascade,
  user_id uuid not null,
  role text not null,
  assigned_at timestamptz default now()
);

create table if not exists status_events (
  id uuid primary key,
  content_id uuid not null references contents(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid,
  changed_at timestamptz default now(),
  note text
);

create table if not exists vault_files (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete restrict,
  file_kind text not null check (file_kind in ('invoice_pdf')),
  bucket_id text not null default 'vault',
  object_path text not null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz default now(),
  created_by uuid
);

create table if not exists vault_events (
  id uuid primary key,
  vault_file_id uuid not null references vault_files(id) on delete cascade,
  event_type text not null check (event_type in ('created','downloaded')),
  actor_id uuid,
  created_at timestamptz default now()
);
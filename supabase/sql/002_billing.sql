-- 002_billing.sql (idempotent)
-- 請求MVP: contents.invoice_id, invoices.invoice_name, invoice_lines.project_name/title, インデックス。
-- RLSは触らない。既存の 001 で invoices / invoice_lines / contents は作成済み想定。

-- A) contents.invoice_id（なければ追加）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contents' and column_name = 'invoice_id'
  ) then
    alter table contents add column invoice_id uuid references invoices(id) on delete set null;
  end if;
end $$;

-- B) invoices.invoice_name（なければ追加）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_name'
  ) then
    alter table invoices add column invoice_name text;
  end if;
end $$;

-- C) invoice_lines.project_name, title（なければ追加）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_lines' and column_name = 'project_name'
  ) then
    alter table invoice_lines add column project_name text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_lines' and column_name = 'title'
  ) then
    alter table invoice_lines add column title text;
  end if;
end $$;

-- D) インデックス（検索・一覧用）
create index if not exists idx_contents_billing
  on contents(org_id, delivery_month, billable_flag, invoice_id);

create index if not exists idx_invoices_org_month
  on invoices(org_id, invoice_month);

create index if not exists idx_invoice_lines_invoice
  on invoice_lines(invoice_id);

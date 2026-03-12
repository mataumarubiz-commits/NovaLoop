-- 005_billing_mvp.sql
-- Billing MVP: invoice_name（請求書フル名）, invoice_lines に project_name/title を追加。
-- contents.invoice_id は既存スキーマにあり二重請求防止に使用。

-- invoices: 請求書の正式表示名（PDFファイル名等に使用）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_name'
  ) then
    alter table invoices add column invoice_name text;
  end if;
end $$;

-- invoice_lines: 明細のプロジェクト名・タイトル（既存は description not null）
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

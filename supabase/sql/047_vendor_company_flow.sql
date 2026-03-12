-- 047_vendor_company_flow.sql
-- 会社側の外注請求導線を追跡するための最小補助列

alter table if exists public.vendors
  add column if not exists vendor_portal_invited_at timestamptz,
  add column if not exists vendor_portal_invited_email text;

alter table if exists public.vendor_invoices
  add column if not exists request_sent_at timestamptz,
  add column if not exists request_sent_by uuid;

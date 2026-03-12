alter table if exists vendor_invoices
  add column if not exists invoice_number text,
  add column if not exists approved_at timestamptz,
  add column if not exists recipient_snapshot jsonb not null default '{}'::jsonb;

create index if not exists vendor_invoices_invoice_number_idx
  on vendor_invoices (org_id, invoice_number);

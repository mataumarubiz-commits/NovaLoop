-- 006_invoice_unique.sql (idempotent)
-- 二重作成防止: draft は (org_id, client_id, invoice_month) で1件、明細は (invoice_id, content_id) で1件。

-- invoices: 同一 org / client / 対象月 で draft が複数ならないようにする（status=draft のときのみ）
create unique index if not exists idx_invoices_draft_unique
  on invoices (org_id, client_id, invoice_month)
  where status = 'draft';

-- invoice_lines: 同一請求書に同じ content が二重で入らないようにする
create unique index if not exists idx_invoice_lines_invoice_content_unique
  on invoice_lines (invoice_id, content_id)
  where content_id is not null;

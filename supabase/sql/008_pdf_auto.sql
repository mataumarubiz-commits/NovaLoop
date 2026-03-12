-- 008_pdf_auto.sql (idempotent)
-- PDF自動生成用: pdf_generated_at を追加（007で pdf_path は追加済み）

alter table invoices add column if not exists pdf_generated_at timestamptz;

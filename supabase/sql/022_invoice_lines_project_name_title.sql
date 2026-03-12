-- 022_invoice_lines_project_name_title.sql (idempotent)
-- invoice_lines.project_name / title が無い環境用（002/005 未実行時）。請求書詳細取得で project_name を select するため必須。

ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS title text;

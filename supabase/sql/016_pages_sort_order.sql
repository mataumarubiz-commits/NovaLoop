-- 016_pages_sort_order.sql (idempotent)
-- pages の並び順用 sort_order カラム

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS pages_org_sort_idx ON public.pages (org_id, sort_order ASC);

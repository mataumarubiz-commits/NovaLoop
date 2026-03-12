-- 025_pages_body_text.sql (idempotent)
-- Pages 本文のプレーンテキスト検索用カラムを追加。
-- 既存の pages.content (jsonb) を body_json とみなし、body_text を補助カラムとして追加する。

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS body_text text;


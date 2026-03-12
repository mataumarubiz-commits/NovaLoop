-- 034_pages_icon_cover.sql (idempotent)
-- 仕様書 §9: ページに icon / cover_path を追加（任意）。社内マニュアル・Notion-lite 用。

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS cover_path text;

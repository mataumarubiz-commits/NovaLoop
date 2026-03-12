-- 035_pages_slug_archived_at.sql (idempotent)
-- ページ管理: slug（重複時 manual-2 等で解決）、archived_at（アーカイブ日時）。

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 既存行で is_archived = true の場合は archived_at を updated_at で埋める（一度だけ）
-- アプリ側でアーカイブ時に archived_at = now() を設定する

CREATE INDEX IF NOT EXISTS pages_org_slug_idx
  ON public.pages (org_id, slug)
  WHERE is_archived = false;

COMMENT ON COLUMN public.pages.slug IS 'URL用識別子。同一org内で重複時は suffix (-2, -3) で解決。';
COMMENT ON COLUMN public.pages.archived_at IS 'アーカイブした日時。is_archived=true と併用。';

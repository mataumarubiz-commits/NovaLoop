-- 039_page_comments_selection_range.sql (idempotent)
-- 選択範囲コメント用。将来の拡張用に selection_range を追加。

ALTER TABLE public.page_comments
  ADD COLUMN IF NOT EXISTS selection_range jsonb;

COMMENT ON COLUMN public.page_comments.selection_range IS '選択範囲コメント用。例: {"from": 0, "to": 10}。NULL の場合はページ単位コメント。';

-- 010_join_request_display_name.sql (idempotent)
-- 参加申請時に「この組織内での表示名」を保存するカラムを追加

ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS requested_display_name text;

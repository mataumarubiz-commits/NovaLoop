-- 案件ステータス: 制作フロー用の値を追加（UI と一致させる）
-- 既存の CHECK 名は環境により異なる場合があるため、status を含む CHECK を列挙して削除する

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'projects'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.projects DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE public.projects SET status = 'internal_production' WHERE status = 'active';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (
    status IN (
      'not_started',
      'paused',
      'completed',
      'internal_production',
      'internal_revision',
      'client_submission',
      'client_revision_work',
      'delivered',
      'invoiced'
    )
  );

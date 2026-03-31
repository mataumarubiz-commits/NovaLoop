-- contents.status を案件と同じフェーズモデルに揃える（旧値は移行）
-- 001_schema の CHECK を置き換え

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
      AND t.relname = 'contents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.contents DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE public.contents SET status = 'canceled' WHERE status = 'cancelled';

UPDATE public.contents SET status = 'internal_production' WHERE status IN ('materials_checked', 'editing');

UPDATE public.contents SET status = 'internal_revision' WHERE status = 'editing_revision';

UPDATE public.contents SET status = 'client_submission' WHERE status IN ('submitted_to_client', 'scheduling');

UPDATE public.contents SET status = 'client_revision_work' WHERE status = 'client_revision';

UPDATE public.contents SET status = 'delivered' WHERE status = 'published';

ALTER TABLE public.contents
  ADD CONSTRAINT contents_status_check CHECK (
    status IN (
      'not_started',
      'internal_production',
      'internal_revision',
      'client_submission',
      'client_revision_work',
      'delivered',
      'invoiced',
      'paused',
      'completed',
      'canceled'
    )
  );

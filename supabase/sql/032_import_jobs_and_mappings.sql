-- 032_import_jobs_and_mappings.sql (idempotent)
-- Import 機能: import_jobs（プレビュー/適用履歴）、import_mappings（client の source→new 対応）。
-- contents.client_id を NULL 許可にし、インポート時にクライアント未解決でも行を落とさない。

-- ---------------------------------------------------------------------------
-- 1) contents.client_id を NULL 許可（インポートで未解決時も insert するため）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.contents
    ALTER COLUMN client_id DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) import_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'applied', 'failed')),
  summary_json jsonb,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_jobs_org_created_idx
  ON public.import_jobs (org_id, created_at DESC);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_jobs_select_admin ON public.import_jobs;
CREATE POLICY import_jobs_select_admin ON public.import_jobs
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

-- INSERT/UPDATE は API (service role) のみ想定

-- ---------------------------------------------------------------------------
-- 3) import_mappings（Apply 時に source client → new client_id を保存）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'client',
  source_id uuid,
  source_key text,
  new_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS import_mappings_job_id_idx
  ON public.import_mappings (job_id);

ALTER TABLE public.import_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_mappings_select_admin ON public.import_mappings;
CREATE POLICY import_mappings_select_admin ON public.import_mappings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.import_jobs ij
      WHERE ij.id = import_mappings.job_id
        AND public.user_role_in_org(ij.org_id) IN ('owner', 'executive_assistant')
    )
  );

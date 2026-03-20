-- 055_competitor_project_layer.sql
-- 競合案件管理シート吸収: 案件レイヤー / ガント / カレンダー / 素材 / 変更 / 収支 / 例外

-- ---------------------------------------------------------------------------
-- 1) projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed')),
  contract_type text NOT NULL DEFAULT 'per_content'
    CHECK (contract_type IN ('per_content', 'retainer', 'fixed_fee', 'monthly')),
  start_date date,
  end_date date,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chatwork_room_id text,
  google_calendar_id text,
  slack_channel_id text,
  discord_channel_id text,
  drive_folder_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_org_client ON public.projects(org_id, client_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_org_owner ON public.projects(org_id, owner_user_id);

DO $$
BEGIN
  CREATE TRIGGER tr_projects_updated
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) rate_cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  unit_label text NOT NULL DEFAULT '本',
  sales_unit_price integer NOT NULL DEFAULT 0,
  standard_cost integer NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_cards_org_project ON public.rate_cards(org_id, project_id, effective_from DESC);

DO $$
BEGIN
  CREATE TRIGGER tr_rate_cards_updated
    BEFORE UPDATE ON public.rate_cards
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) project_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE CASCADE,
  task_type text NOT NULL
    CHECK (task_type IN ('materials', 'script', 'editing', 'internal_review', 'client_review', 'revision', 'publishing', 'publish')),
  title text NOT NULL,
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  planned_start_date date,
  planned_end_date date,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'blocked', 'done')),
  dependency_task_id uuid REFERENCES public.project_tasks(id) ON DELETE SET NULL,
  workload_points integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_org_project ON public.project_tasks(org_id, project_id, planned_end_date);
CREATE INDEX IF NOT EXISTS idx_project_tasks_org_assignee ON public.project_tasks(org_id, assignee_user_id, status);

DO $$
BEGIN
  CREATE TRIGGER tr_project_tasks_updated
    BEFORE UPDATE ON public.project_tasks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 4) schedule_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('editor_due', 'client_due', 'publish', 'meeting', 'payout', 'invoice_issue', 'reminder', 'custom')),
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT true,
  external_source text,
  external_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_events_org_start ON public.schedule_events(org_id, start_at);
CREATE INDEX IF NOT EXISTS idx_schedule_events_org_project ON public.schedule_events(org_id, project_id, start_at);

DO $$
BEGIN
  CREATE TRIGGER tr_schedule_events_updated
    BEFORE UPDATE ON public.schedule_events
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 5) material_assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE CASCADE,
  asset_type text NOT NULL
    CHECK (asset_type IN ('raw', 'script', 'draft', 'revision', 'final', 'thumbnail', 'reference', 'proof')),
  title text NOT NULL,
  storage_path text,
  external_url text,
  version_no integer NOT NULL DEFAULT 1,
  review_status text NOT NULL DEFAULT 'active'
    CHECK (review_status IN ('active', 'approved', 'rejected', 'archived')),
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_assets_org_project ON public.material_assets(org_id, project_id, asset_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_assets_org_content ON public.material_assets(org_id, content_id, created_at DESC);

DO $$
BEGIN
  CREATE TRIGGER tr_material_assets_updated
    BEFORE UPDATE ON public.material_assets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 6) change_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE SET NULL,
  request_type text NOT NULL
    CHECK (request_type IN ('deadline_change', 'spec_change', 'revision_additional', 'asset_replace', 'publish_reschedule', 'extra_deliverable')),
  summary text NOT NULL,
  requested_by text,
  impact_level text NOT NULL DEFAULT 'medium'
    CHECK (impact_level IN ('low', 'medium', 'high')),
  due_shift_days integer NOT NULL DEFAULT 0,
  extra_sales_amount integer NOT NULL DEFAULT 0,
  extra_cost_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'approved', 'rejected', 'applied')),
  approved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_org_project ON public.change_requests(org_id, project_id, status, created_at DESC);

DO $$
BEGIN
  CREATE TRIGGER tr_change_requests_updated
    BEFORE UPDATE ON public.change_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 7) expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  content_id uuid REFERENCES public.contents(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount integer NOT NULL DEFAULT 0,
  occurred_on date NOT NULL,
  receipt_path text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_project ON public.expenses(org_id, project_id, occurred_on DESC);

DO $$
BEGIN
  CREATE TRIGGER tr_expenses_updated
    BEFORE UPDATE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 8) exceptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.contents(id) ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (source_type IN ('system', 'manual', 'sync')),
  exception_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high')),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'ignored')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exceptions_org_status ON public.exceptions(org_id, status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_org_project ON public.exceptions(org_id, project_id, detected_at DESC);

DO $$
BEGIN
  CREATE TRIGGER tr_exceptions_updated
    BEFORE UPDATE ON public.exceptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 9) contents 拡張
-- ---------------------------------------------------------------------------
ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_no integer,
  ADD COLUMN IF NOT EXISTS publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignee_editor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_checker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workload_points integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS estimated_cost integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS material_status text NOT NULL DEFAULT 'not_ready'
    CHECK (material_status IN ('not_ready', 'collecting', 'ready', 'approved')),
  ADD COLUMN IF NOT EXISTS draft_status text NOT NULL DEFAULT 'not_started'
    CHECK (draft_status IN ('not_started', 'drafting', 'reviewing', 'approved')),
  ADD COLUMN IF NOT EXISTS final_status text NOT NULL DEFAULT 'not_started'
    CHECK (final_status IN ('not_started', 'assembling', 'ready', 'delivered')),
  ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100
    CHECK (health_score BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS idx_contents_org_project ON public.contents(org_id, project_id, due_client_at);
CREATE INDEX IF NOT EXISTS idx_contents_org_health ON public.contents(org_id, health_score);

INSERT INTO public.projects (
  id,
  org_id,
  client_id,
  name,
  status,
  contract_type,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  source.org_id,
  source.client_id,
  source.project_name,
  'active',
  'per_content',
  now(),
  now()
FROM (
  SELECT DISTINCT org_id, client_id, project_name
  FROM public.contents
  WHERE COALESCE(project_name, '') <> ''
) AS source
LEFT JOIN public.projects existing
  ON existing.org_id = source.org_id
 AND existing.client_id = source.client_id
 AND existing.name = source.project_name
WHERE existing.id IS NULL;

UPDATE public.contents AS c
SET project_id = p.id
FROM public.projects AS p
WHERE c.project_id IS NULL
  AND c.org_id = p.org_id
  AND c.client_id = p.client_id
  AND c.project_name = p.name;

UPDATE public.contents
SET health_score = GREATEST(
  0,
  LEAST(
    100,
    100
      - CASE WHEN COALESCE(unit_price, 0) <= 0 THEN 25 ELSE 0 END
      - CASE WHEN due_editor_at > due_client_at THEN 35 ELSE 0 END
      - CASE WHEN material_status = 'not_ready' THEN 10 ELSE 0 END
      - CASE WHEN assignee_editor_user_id IS NULL THEN 15 ELSE 0 END
      - CASE WHEN COALESCE(next_action, '') = '' THEN 10 ELSE 0 END
      - CASE WHEN COALESCE(revision_count, 0) >= 3 THEN 10 ELSE 0 END
      - CASE WHEN COALESCE(estimated_cost, 0) > COALESCE(unit_price, 0) AND COALESCE(unit_price, 0) > 0 THEN 20 ELSE 0 END
  )
);

-- ---------------------------------------------------------------------------
-- 10) project-assets bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS project_assets_objects_select ON storage.objects;
CREATE POLICY project_assets_objects_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_org_member(split_part(name, '/', 1)::uuid)
  );

DROP POLICY IF EXISTS project_assets_objects_insert ON storage.objects;
CREATE POLICY project_assets_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

DROP POLICY IF EXISTS project_assets_objects_update ON storage.objects;
CREATE POLICY project_assets_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

DROP POLICY IF EXISTS project_assets_objects_delete ON storage.objects;
CREATE POLICY project_assets_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 1)::uuid) IN ('owner', 'executive_assistant')
  );

-- ---------------------------------------------------------------------------
-- 11) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select_org_members ON public.projects;
CREATE POLICY projects_select_org_members ON public.projects
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS projects_admin_write ON public.projects;
CREATE POLICY projects_admin_write ON public.projects
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS rate_cards_select_admin ON public.rate_cards;
CREATE POLICY rate_cards_select_admin ON public.rate_cards
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS rate_cards_admin_write ON public.rate_cards;
CREATE POLICY rate_cards_admin_write ON public.rate_cards
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS project_tasks_select_org_members ON public.project_tasks;
CREATE POLICY project_tasks_select_org_members ON public.project_tasks
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS project_tasks_admin_write ON public.project_tasks;
CREATE POLICY project_tasks_admin_write ON public.project_tasks
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS schedule_events_select_org_members ON public.schedule_events;
CREATE POLICY schedule_events_select_org_members ON public.schedule_events
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS schedule_events_admin_write ON public.schedule_events;
CREATE POLICY schedule_events_admin_write ON public.schedule_events
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS material_assets_select_org_members ON public.material_assets;
CREATE POLICY material_assets_select_org_members ON public.material_assets
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS material_assets_admin_write ON public.material_assets;
CREATE POLICY material_assets_admin_write ON public.material_assets
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS change_requests_select_org_members ON public.change_requests;
CREATE POLICY change_requests_select_org_members ON public.change_requests
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS change_requests_admin_write ON public.change_requests;
CREATE POLICY change_requests_admin_write ON public.change_requests
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS expenses_select_admin ON public.expenses;
CREATE POLICY expenses_select_admin ON public.expenses
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS expenses_admin_write ON public.expenses;
CREATE POLICY expenses_admin_write ON public.expenses
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS exceptions_select_org_members ON public.exceptions;
CREATE POLICY exceptions_select_org_members ON public.exceptions
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS exceptions_admin_write ON public.exceptions;
CREATE POLICY exceptions_admin_write ON public.exceptions
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

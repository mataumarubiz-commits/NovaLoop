-- 060_page_template_lifecycle.sql (idempotent)
-- Pages template lifecycle / shared template distribution / release history

ALTER TABLE public.template_catalog
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'official',
  ADD COLUMN IF NOT EXISTS owner_org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sharing_scope text NOT NULL DEFAULT 'official',
  ADD COLUMN IF NOT EXISTS industry_tag text,
  ADD COLUMN IF NOT EXISTS base_template_catalog_id uuid REFERENCES public.template_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recommendation_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preview_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS release_notes text NOT NULL DEFAULT '';

ALTER TABLE public.org_template_installs
  ADD COLUMN IF NOT EXISTS root_page_id uuid REFERENCES public.pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS install_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS failure_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_applied_version text;

ALTER TABLE public.template_page_definitions
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.template_release_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_catalog_id uuid NOT NULL REFERENCES public.template_catalog(id) ON DELETE CASCADE,
  version text NOT NULL,
  release_notes text NOT NULL DEFAULT '',
  page_snapshot_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_release_history_template_version_unique UNIQUE (template_catalog_id, version)
);

CREATE INDEX IF NOT EXISTS template_catalog_source_scope_idx
  ON public.template_catalog (source_type, sharing_scope, status, sort_order ASC);

CREATE INDEX IF NOT EXISTS template_catalog_owner_org_idx
  ON public.template_catalog (owner_org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS org_template_installs_status_idx
  ON public.org_template_installs (org_id, install_status, installed_at DESC);

CREATE INDEX IF NOT EXISTS template_release_history_catalog_version_idx
  ON public.template_release_history (template_catalog_id, created_at DESC);

ALTER TABLE public.template_release_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_catalog_select_authenticated ON public.template_catalog;
CREATE POLICY template_catalog_select_authenticated
  ON public.template_catalog
  FOR SELECT
  USING (
    is_official = true
    OR sharing_scope = 'industry'
    OR (
      owner_org_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.app_users au
        WHERE au.user_id = auth.uid()
          AND au.org_id = public.template_catalog.owner_org_id
      )
    )
  );

DROP POLICY IF EXISTS org_template_installs_update_admin ON public.org_template_installs;
CREATE POLICY org_template_installs_update_admin
  ON public.org_template_installs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.org_template_installs.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.org_template_installs.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS org_template_installs_delete_admin ON public.org_template_installs;
CREATE POLICY org_template_installs_delete_admin
  ON public.org_template_installs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.org_template_installs.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS template_release_history_select_by_catalog_scope ON public.template_release_history;
CREATE POLICY template_release_history_select_by_catalog_scope
  ON public.template_release_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.template_catalog tc
      WHERE tc.id = public.template_release_history.template_catalog_id
        AND (
          tc.is_official = true
          OR tc.sharing_scope = 'industry'
          OR (
            tc.owner_org_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.app_users au
              WHERE au.user_id = auth.uid()
                AND au.org_id = tc.owner_org_id
            )
          )
        )
    )
  );

COMMENT ON COLUMN public.template_catalog.source_type IS 'official or shared';
COMMENT ON COLUMN public.template_catalog.owner_org_id IS 'Shared template owner org. NULL for official templates.';
COMMENT ON COLUMN public.template_catalog.sharing_scope IS 'official / org / industry';
COMMENT ON COLUMN public.template_catalog.industry_tag IS 'Optional industry/distribution label for shared templates.';
COMMENT ON COLUMN public.template_catalog.recommendation_json IS 'Recommended related template keys.';
COMMENT ON COLUMN public.template_catalog.preview_payload_json IS 'Derived preview payload for visual/template preview.';
COMMENT ON COLUMN public.org_template_installs.install_status IS 'pending / completed / failed';
COMMENT ON COLUMN public.org_template_installs.root_page_id IS 'Root page created for grouped install rendering.';
COMMENT ON TABLE public.template_release_history IS 'Immutable release snapshots for template version diff and update application.';

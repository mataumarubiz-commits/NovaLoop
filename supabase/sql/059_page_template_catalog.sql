-- 059_page_template_catalog.sql (idempotent)
-- Pages 公式テンプレカタログ / 導入履歴 / ページバインディング

CREATE TABLE IF NOT EXISTS public.template_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  badge_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_official boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  preview_image_path text,
  version text NOT NULL DEFAULT '1.0.0',
  status text NOT NULL DEFAULT 'active',
  integration_targets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_page_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_catalog_id uuid NOT NULL REFERENCES public.template_catalog(id) ON DELETE CASCADE,
  parent_page_key text,
  slug_seed text NOT NULL,
  title text NOT NULL,
  icon text,
  order_index integer NOT NULL DEFAULT 0,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_type text NOT NULL DEFAULT 'doc',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_page_definitions_template_slug_unique UNIQUE (template_catalog_id, slug_seed)
);

CREATE TABLE IF NOT EXISTS public.org_template_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_catalog_id uuid NOT NULL REFERENCES public.template_catalog(id) ON DELETE RESTRICT,
  installed_by uuid NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  install_name text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  include_sample_content boolean NOT NULL DEFAULT true,
  group_under_root boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.page_template_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_id uuid NOT NULL REFERENCES public.org_template_installs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  template_catalog_id uuid NOT NULL REFERENCES public.template_catalog(id) ON DELETE RESTRICT,
  template_page_definition_id uuid NOT NULL REFERENCES public.template_page_definitions(id) ON DELETE RESTRICT,
  is_customized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_template_bindings_page_unique UNIQUE (page_id),
  CONSTRAINT page_template_bindings_install_definition_unique UNIQUE (install_id, template_page_definition_id)
);

CREATE INDEX IF NOT EXISTS template_catalog_sort_idx
  ON public.template_catalog (sort_order ASC, key ASC);

CREATE INDEX IF NOT EXISTS template_page_definitions_catalog_order_idx
  ON public.template_page_definitions (template_catalog_id, order_index ASC);

CREATE INDEX IF NOT EXISTS org_template_installs_org_idx
  ON public.org_template_installs (org_id, installed_at DESC);

CREATE INDEX IF NOT EXISTS page_template_bindings_org_page_idx
  ON public.page_template_bindings (org_id, page_id);

CREATE INDEX IF NOT EXISTS page_template_bindings_install_idx
  ON public.page_template_bindings (install_id, template_catalog_id);

ALTER TABLE public.template_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_page_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_template_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_template_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_catalog_select_authenticated ON public.template_catalog;
CREATE POLICY template_catalog_select_authenticated
  ON public.template_catalog
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS template_page_definitions_select_authenticated ON public.template_page_definitions;
CREATE POLICY template_page_definitions_select_authenticated
  ON public.template_page_definitions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS org_template_installs_select_org_members ON public.org_template_installs;
CREATE POLICY org_template_installs_select_org_members
  ON public.org_template_installs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.org_template_installs.org_id
    )
  );

DROP POLICY IF EXISTS org_template_installs_insert_admin ON public.org_template_installs;
CREATE POLICY org_template_installs_insert_admin
  ON public.org_template_installs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.org_template_installs.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS page_template_bindings_select_org_members ON public.page_template_bindings;
CREATE POLICY page_template_bindings_select_org_members
  ON public.page_template_bindings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.page_template_bindings.org_id
    )
  );

DROP POLICY IF EXISTS page_template_bindings_insert_admin ON public.page_template_bindings;
CREATE POLICY page_template_bindings_insert_admin
  ON public.page_template_bindings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.page_template_bindings.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

DROP POLICY IF EXISTS page_template_bindings_update_admin ON public.page_template_bindings;
CREATE POLICY page_template_bindings_update_admin
  ON public.page_template_bindings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.page_template_bindings.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.user_id = auth.uid()
        AND au.org_id = public.page_template_bindings.org_id
        AND au.role IN ('owner', 'executive_assistant')
    )
  );

COMMENT ON TABLE public.template_catalog IS 'Pages の公式 / 将来の共有テンプレカタログ';
COMMENT ON TABLE public.template_page_definitions IS 'テンプレ内ページ定義。content_json は sample 用の初期本文。';
COMMENT ON TABLE public.org_template_installs IS '組織ごとのテンプレ導入履歴。';
COMMENT ON TABLE public.page_template_bindings IS '実ページとテンプレ定義の対応。install_id で同一導入単位を追跡する。';

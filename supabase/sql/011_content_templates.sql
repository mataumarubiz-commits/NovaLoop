-- 011_content_templates.sql (idempotent)
-- クライアント別コンテンツテンプレート。org_id で分離、RLS は contents と同様（org メンバーが select/insert/update/delete）

CREATE TABLE IF NOT EXISTS public.content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_title text,
  default_unit_price numeric,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_templates_org_client_idx
  ON public.content_templates (org_id, client_id);

ALTER TABLE public.content_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_templates_select_org_members ON public.content_templates;
CREATE POLICY content_templates_select_org_members ON public.content_templates
  FOR SELECT USING (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid() and au.org_id = content_templates.org_id
    )
  );

DROP POLICY IF EXISTS content_templates_insert_org_members ON public.content_templates;
CREATE POLICY content_templates_insert_org_members ON public.content_templates
  FOR INSERT WITH CHECK (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid() and au.org_id = content_templates.org_id
    )
  );

DROP POLICY IF EXISTS content_templates_update_org_members ON public.content_templates;
CREATE POLICY content_templates_update_org_members ON public.content_templates
  FOR UPDATE USING (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid() and au.org_id = content_templates.org_id
    )
  )
  WITH CHECK (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid() and au.org_id = content_templates.org_id
    )
  );

DROP POLICY IF EXISTS content_templates_delete_org_members ON public.content_templates;
CREATE POLICY content_templates_delete_org_members ON public.content_templates
  FOR DELETE USING (
    exists (
      select 1 from app_users au
      where au.user_id = auth.uid() and au.org_id = content_templates.org_id
    )
  );

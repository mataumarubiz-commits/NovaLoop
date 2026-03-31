-- 063_custom_role_permissions_and_member_flows.sql (idempotent)
-- Custom role permissions are now enforced for non-accounting workflow surfaces.
-- Accounting remains owner/executive_assistant only.

CREATE OR REPLACE FUNCTION public.user_permissions_in_org(org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permissions, '{}'::jsonb)
  FROM public.app_users au
  LEFT JOIN public.org_roles r ON r.id = au.role_id
  WHERE au.user_id = auth.uid()
    AND au.org_id = user_permissions_in_org.org_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.org_permission_enabled(org_id uuid, permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN public.user_role_in_org(org_permission_enabled.org_id) IN ('owner', 'executive_assistant') THEN true
      ELSE COALESCE((public.user_permissions_in_org(org_permission_enabled.org_id) ->> permission_key)::boolean, false)
    END;
$$;

GRANT EXECUTE ON FUNCTION public.user_permissions_in_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_permission_enabled(uuid, text) TO authenticated;

ALTER TABLE public.org_invites
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.org_roles(id);

ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS requested_role_id uuid REFERENCES public.org_roles(id);

UPDATE public.org_invites oi
SET role_id = r.id
FROM public.org_roles r
WHERE oi.role_id IS NULL
  AND oi.org_id = r.org_id
  AND oi.role_key = r.key;

UPDATE public.join_requests jr
SET requested_role_id = r.id
FROM public.org_roles r
WHERE jr.requested_role_id IS NULL
  AND jr.org_id = r.org_id
  AND (
    CASE
      WHEN COALESCE(jr.requested_role, 'member') IN ('owner', 'executive_assistant', 'member') THEN COALESCE(jr.requested_role, 'member')
      ELSE 'member'
    END
  ) = r.key;

-- app_users: keep self-insert policy, but member management writes require members_manage.
DROP POLICY IF EXISTS app_users_insert_admin ON public.app_users;
DROP POLICY IF EXISTS app_users_update_admin ON public.app_users;
DROP POLICY IF EXISTS app_users_delete_admin ON public.app_users;

CREATE POLICY app_users_insert_managers ON public.app_users
  FOR INSERT
  WITH CHECK (public.org_permission_enabled(org_id, 'members_manage'));

CREATE POLICY app_users_update_managers ON public.app_users
  FOR UPDATE
  USING (public.org_permission_enabled(org_id, 'members_manage'))
  WITH CHECK (public.org_permission_enabled(org_id, 'members_manage'));

CREATE POLICY app_users_delete_managers ON public.app_users
  FOR DELETE
  USING (public.org_permission_enabled(org_id, 'members_manage'));

-- clients: workflow managers may create/update/archive client master data.
DROP POLICY IF EXISTS clients_admin_write ON public.clients;
DROP POLICY IF EXISTS clients_insert_admin ON public.clients;
DROP POLICY IF EXISTS clients_update_admin ON public.clients;
DROP POLICY IF EXISTS clients_delete_admin ON public.clients;

CREATE POLICY clients_insert_contents_write ON public.clients
  FOR INSERT
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

CREATE POLICY clients_update_contents_write ON public.clients
  FOR UPDATE
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

CREATE POLICY clients_delete_contents_write ON public.clients
  FOR DELETE
  USING (public.org_permission_enabled(org_id, 'contents_write'));

-- contents and related workflow tables.
DROP POLICY IF EXISTS contents_write_org_members ON public.contents;
DROP POLICY IF EXISTS contents_insert_org_members ON public.contents;
DROP POLICY IF EXISTS contents_update_org_members ON public.contents;
DROP POLICY IF EXISTS contents_delete_org_members ON public.contents;

CREATE POLICY contents_insert_roles ON public.contents
  FOR INSERT
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

CREATE POLICY contents_update_roles ON public.contents
  FOR UPDATE
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

CREATE POLICY contents_delete_roles ON public.contents
  FOR DELETE
  USING (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS content_assignments_write_org_members ON public.content_assignments;
DROP POLICY IF EXISTS content_assignments_update_org_members ON public.content_assignments;
DROP POLICY IF EXISTS content_assignments_delete_org_members ON public.content_assignments;

CREATE POLICY content_assignments_insert_roles ON public.content_assignments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.content_assignments.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

CREATE POLICY content_assignments_update_roles ON public.content_assignments
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.content_assignments.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.content_assignments.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

CREATE POLICY content_assignments_delete_roles ON public.content_assignments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.content_assignments.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

DROP POLICY IF EXISTS status_events_write_org_members ON public.status_events;
DROP POLICY IF EXISTS status_events_update_org_members ON public.status_events;
DROP POLICY IF EXISTS status_events_delete_org_members ON public.status_events;

CREATE POLICY status_events_insert_roles ON public.status_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.status_events.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

CREATE POLICY status_events_update_roles ON public.status_events
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.status_events.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.status_events.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

CREATE POLICY status_events_delete_roles ON public.status_events
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.contents c
      WHERE c.id = public.status_events.content_id
        AND public.org_permission_enabled(c.org_id, 'contents_write')
    )
  );

DROP POLICY IF EXISTS content_templates_insert_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_update_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_delete_org_members ON public.content_templates;
DROP POLICY IF EXISTS content_templates_admin_write ON public.content_templates;

CREATE POLICY content_templates_roles_write ON public.content_templates
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS projects_admin_write ON public.projects;
CREATE POLICY projects_contents_write ON public.projects
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS project_tasks_admin_write ON public.project_tasks;
CREATE POLICY project_tasks_contents_write ON public.project_tasks
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS schedule_events_admin_write ON public.schedule_events;
CREATE POLICY schedule_events_contents_write ON public.schedule_events
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS material_assets_admin_write ON public.material_assets;
CREATE POLICY material_assets_contents_write ON public.material_assets
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS change_requests_admin_write ON public.change_requests;
CREATE POLICY change_requests_contents_write ON public.change_requests
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS exceptions_admin_write ON public.exceptions;
CREATE POLICY exceptions_contents_write ON public.exceptions
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS project_assets_objects_insert ON storage.objects;
DROP POLICY IF EXISTS project_assets_objects_update ON storage.objects;
DROP POLICY IF EXISTS project_assets_objects_delete ON storage.objects;

CREATE POLICY project_assets_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'contents_write')
  );

CREATE POLICY project_assets_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'contents_write')
  )
  WITH CHECK (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'contents_write')
  );

CREATE POLICY project_assets_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'project-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'contents_write')
  );

-- pages and related assets/history.
DROP POLICY IF EXISTS pages_write_admin ON public.pages;
CREATE POLICY pages_write_roles ON public.pages
  FOR ALL
  USING (public.org_permission_enabled(org_id, 'pages_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'pages_write'));

DROP POLICY IF EXISTS page_revisions_insert_admin ON public.page_revisions;
CREATE POLICY page_revisions_insert_roles ON public.page_revisions
  FOR INSERT
  WITH CHECK (public.org_permission_enabled(org_id, 'pages_write'));

DROP POLICY IF EXISTS page_assets_objects_insert ON storage.objects;
DROP POLICY IF EXISTS page_assets_objects_update ON storage.objects;
DROP POLICY IF EXISTS page_assets_objects_delete ON storage.objects;

CREATE POLICY page_assets_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'pages_write')
  );

CREATE POLICY page_assets_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'pages_write')
  )
  WITH CHECK (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'pages_write')
  );

CREATE POLICY page_assets_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'page-assets'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
    AND public.org_permission_enabled(split_part(name, '/', 1)::uuid, 'pages_write')
  );

-- member-management flows.
DROP POLICY IF EXISTS org_invites_admin_select ON public.org_invites;
DROP POLICY IF EXISTS org_invites_admin_update ON public.org_invites;
DROP POLICY IF EXISTS org_invites_delete_managers ON public.org_invites;

CREATE POLICY org_invites_select_managers ON public.org_invites
  FOR SELECT
  USING (public.org_permission_enabled(org_id, 'members_manage'));

CREATE POLICY org_invites_update_managers ON public.org_invites
  FOR UPDATE
  USING (public.org_permission_enabled(org_id, 'members_manage'))
  WITH CHECK (public.org_permission_enabled(org_id, 'members_manage'));

CREATE POLICY org_invites_delete_managers ON public.org_invites
  FOR DELETE
  USING (public.org_permission_enabled(org_id, 'members_manage'));

DROP POLICY IF EXISTS join_requests_requester_select ON public.join_requests;
DROP POLICY IF EXISTS join_requests_owner_select_update ON public.join_requests;
DROP POLICY IF EXISTS join_requests_select ON public.join_requests;
DROP POLICY IF EXISTS join_requests_owner_update ON public.join_requests;
DROP POLICY IF EXISTS join_requests_manager_update ON public.join_requests;

CREATE POLICY join_requests_select ON public.join_requests
  FOR SELECT
  USING (
    requester_user_id = auth.uid()
    OR public.org_permission_enabled(org_id, 'members_manage')
  );

CREATE POLICY join_requests_manager_update ON public.join_requests
  FOR UPDATE
  USING (public.org_permission_enabled(org_id, 'members_manage'))
  WITH CHECK (public.org_permission_enabled(org_id, 'members_manage'));

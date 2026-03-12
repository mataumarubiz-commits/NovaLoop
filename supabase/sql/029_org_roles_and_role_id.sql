-- 029_org_roles_and_role_id.sql (idempotent)
-- 組織ごとのカスタムロール（土台）と app_users.role_id 追加

-- org_roles テーブル
CREATE TABLE IF NOT EXISTS public.org_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_roles_org_key_idx
  ON public.org_roles (org_id, key);

ALTER TABLE public.org_roles ENABLE ROW LEVEL SECURITY;

-- RLS: org メンバーは select、owner / executive_assistant は CRUD
DROP POLICY IF EXISTS org_roles_select_members ON public.org_roles;
CREATE POLICY org_roles_select_members ON public.org_roles
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS org_roles_admin_write ON public.org_roles;
CREATE POLICY org_roles_admin_write ON public.org_roles
  FOR ALL
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

-- app_users に role_id 追加（存在しなければ）
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.org_roles(id);

-- 各 org に system role (owner/executive_assistant/member) を作成（存在しなければ）
INSERT INTO public.org_roles (org_id, key, name, is_system, sort_order)
SELECT o.id, 'owner', 'オーナー', true, 0
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.org_roles r WHERE r.org_id = o.id AND r.key = 'owner'
);

INSERT INTO public.org_roles (org_id, key, name, is_system, sort_order)
SELECT o.id, 'executive_assistant', '秘書', true, 1
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.org_roles r WHERE r.org_id = o.id AND r.key = 'executive_assistant'
);

INSERT INTO public.org_roles (org_id, key, name, is_system, sort_order)
SELECT o.id, 'member', 'メンバー', true, 2
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.org_roles r WHERE r.org_id = o.id AND r.key = 'member'
);

-- 既存 app_users.role から role_id を可能な範囲でセット（未設定のみ）
UPDATE public.app_users au
SET role_id = r.id
FROM public.org_roles r
WHERE au.role_id IS NULL
  AND au.org_id = r.org_id
  AND au.role = r.key
  AND au.role IN ('owner', 'executive_assistant', 'member');


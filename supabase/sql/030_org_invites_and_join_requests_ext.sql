-- 030_org_invites_and_join_requests_ext.sql (idempotent)
-- 招待(org_invites)と参加申請(join_requests)拡張。招待/承認はAPI+service roleで運用。

-- ---------------------------------------------------------------------------
-- 1) org_invites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_key text NOT NULL DEFAULT 'member',
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_key ON public.org_invites (token);
CREATE INDEX IF NOT EXISTS org_invites_org_status_idx ON public.org_invites (org_id, status);
CREATE INDEX IF NOT EXISTS org_invites_email_idx ON public.org_invites (email);

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- RLS: org の owner/executive_assistant のみ select/update（招待一覧・取り消し・再送）
-- insert は API (service role) で行う想定。anon では insert 不可のためポリシーは最小限。
DROP POLICY IF EXISTS org_invites_admin_select ON public.org_invites;
CREATE POLICY org_invites_admin_select ON public.org_invites
  FOR SELECT
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

DROP POLICY IF EXISTS org_invites_admin_update ON public.org_invites;
CREATE POLICY org_invites_admin_update ON public.org_invites
  FOR UPDATE
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

-- 招待受け入れ: token で検索するため、受け手は invite を select できない。
-- accept は API 経由（service role）で行う。

-- ---------------------------------------------------------------------------
-- 2) join_requests に requester_email, message, decided_by を追加
-- ---------------------------------------------------------------------------
ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS requester_email text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth.users(id);

-- join_requests: SELECT は申請者本人 or その org の owner/executive_assistant
DROP POLICY IF EXISTS join_requests_owner_select_update ON public.join_requests;
DROP POLICY IF EXISTS join_requests_requester_select ON public.join_requests;
CREATE POLICY join_requests_select ON public.join_requests
  FOR SELECT
  USING (
    requester_user_id = auth.uid()
    OR public.user_role_in_org(org_id) IN ('owner', 'executive_assistant')
  );
CREATE POLICY join_requests_owner_update ON public.join_requests
  FOR UPDATE
  USING (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'))
  WITH CHECK (public.user_role_in_org(org_id) IN ('owner', 'executive_assistant'));

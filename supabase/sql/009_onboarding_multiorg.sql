-- 009_onboarding_multiorg.sql (idempotent)
-- user_profiles, app_users 拡張（マルチ組織）, join_requests, notifications
-- 初回オンボーディング・組織スイッチャー・参加申請・通知のMVP用

-- organizations: オンボーディングで新規作成できるよう authenticated に INSERT 許可
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_insert_authenticated ON public.organizations;
CREATE POLICY organizations_insert_authenticated ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 1) user_profiles（表示名・active_org_id）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  active_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) app_users を membership 扱いに拡張
-- ---------------------------------------------------------------------------
-- user_id の unique を外す（複数 org 所属のため）
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_user_id_key;

-- unique(user_id, org_id) を付与（既存ならスキップ）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_users_user_id_org_id_key'
      AND conrelid = 'public.app_users'::regclass
  ) THEN
    ALTER TABLE public.app_users ADD CONSTRAINT app_users_user_id_org_id_key UNIQUE (user_id, org_id);
  END IF;
END $$;

-- id に default を付与（upsert で insert 時用）
ALTER TABLE public.app_users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- カラム追加（既存ならスキップ）
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
-- role の check に 'none' を追加（既存: owner, executive_assistant, pm, director, worker）
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('owner', 'executive_assistant', 'pm', 'director', 'worker', 'none'));

-- ---------------------------------------------------------------------------
-- 3) join_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_role text,
  created_at timestamptz DEFAULT now(),
  decided_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 4) notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- user_profiles: 本人のみ select / update / insert
DROP POLICY IF EXISTS user_profiles_self ON public.user_profiles;
CREATE POLICY user_profiles_self ON public.user_profiles
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- app_users: 自分で自分を追加する INSERT を許可（オンボーディングで org 作成後に owner として追加するため）
DROP POLICY IF EXISTS app_users_insert_self ON public.app_users;
CREATE POLICY app_users_insert_self ON public.app_users
  FOR INSERT WITH CHECK (user_id = auth.uid());
-- 既存: select は本人 or 同一 org の owner/assistant、update は owner のみ（004 のまま）

-- join_requests: requester は自分が作った申請を select。owner は owner_user_id = auth.uid() を select/update
DROP POLICY IF EXISTS join_requests_requester_select ON public.join_requests;
CREATE POLICY join_requests_requester_select ON public.join_requests
  FOR SELECT USING (requester_user_id = auth.uid());

DROP POLICY IF EXISTS join_requests_owner_select_update ON public.join_requests;
CREATE POLICY join_requests_owner_select_update ON public.join_requests
  FOR ALL USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS join_requests_insert ON public.join_requests;
CREATE POLICY join_requests_insert ON public.join_requests
  FOR INSERT WITH CHECK (requester_user_id = auth.uid());

-- notifications: recipient のみ select/update（insert は service role のみ）
DROP POLICY IF EXISTS notifications_recipient_select ON public.notifications;
CREATE POLICY notifications_recipient_select ON public.notifications
  FOR SELECT USING (recipient_user_id = auth.uid());
DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
CREATE POLICY notifications_recipient_update ON public.notifications
  FOR UPDATE USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- notifications の insert は API (service role) で行う。RLS では recipient のみ select/update。

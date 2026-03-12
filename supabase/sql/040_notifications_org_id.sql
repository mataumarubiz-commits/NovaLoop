-- 040_notifications_org_id.sql (idempotent)
-- notifications に org_id を追加してorg別フィルタを可能にする

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- インデックス
CREATE INDEX IF NOT EXISTS notifications_recipient_user_id_idx ON public.notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS notifications_org_id_idx ON public.notifications(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_read_at_idx ON public.notifications(read_at) WHERE read_at IS NULL;

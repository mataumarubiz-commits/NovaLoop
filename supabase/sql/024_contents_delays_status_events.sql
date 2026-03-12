-- 024_contents_delays_status_events.sql (idempotent)
-- 納期漏れ防止: contents に編集者/先方提出日時、status_events に org_id。

-- A) contents: 編集者提出・先方提出の記録
ALTER TABLE public.contents ADD COLUMN IF NOT EXISTS editor_submitted_at timestamptz;
ALTER TABLE public.contents ADD COLUMN IF NOT EXISTS client_submitted_at timestamptz;

-- B) status_events: org_id を追加（履歴の org 絞り用）
ALTER TABLE public.status_events ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
-- 既存行の org_id を content から補完（任意）
UPDATE public.status_events se
SET org_id = (SELECT c.org_id FROM public.contents c WHERE c.id = se.content_id LIMIT 1)
WHERE se.org_id IS NULL;

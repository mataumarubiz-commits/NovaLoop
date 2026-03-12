-- 042_notifications_type_alignment.sql (idempotent)
-- 旧通知typeを通知センター標準typeへ寄せる。

UPDATE public.notifications
SET type = 'membership.requested'
WHERE type = 'join_request';

UPDATE public.notifications
SET type = 'membership.approved'
WHERE type = 'join_approved';

UPDATE public.notifications
SET type = 'membership.rejected'
WHERE type = 'join_rejected';

UPDATE public.notifications
SET type = 'contents.client_due_overdue'
WHERE type = 'deadline_alert';

UPDATE public.notifications
SET type = 'contents.editor_due_overdue'
WHERE type = 'vendor_delay';

UPDATE public.notifications
SET type = 'payouts.pending_action'
WHERE type = 'payout_due';

CREATE INDEX IF NOT EXISTS notifications_org_recipient_created_idx
  ON public.notifications(org_id, recipient_user_id, created_at DESC);

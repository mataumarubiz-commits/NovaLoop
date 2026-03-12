-- 041_notifications_backfill_org_id.sql (idempotent)
-- notifications.org_id が NULL の既存行を payload.org_id から補完する。

UPDATE public.notifications
SET org_id = (payload->>'org_id')::uuid
WHERE org_id IS NULL
  AND payload ? 'org_id'
  AND (payload->>'org_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

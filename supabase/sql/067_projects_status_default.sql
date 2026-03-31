-- 案件 status の列 DEFAULT から legacy の active を外す（新規行が active に戻るのを防ぐ）
-- 065 で CHECK 済みの環境では active は列に残っていない想定。残っていれば internal_production に寄せる。

UPDATE public.projects SET status = 'internal_production' WHERE status = 'active';

ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'not_started';

-- 064_ops_moat_features.sql
-- Competitor moat feature baseline:
-- - external channel settings
-- - content review rounds / timecode comments
-- - vendor invoice evidence attachments
-- - background export processing
-- - expanded payout CSV format support

-- ---------------------------------------------------------------------------
-- 1) org_settings / export_jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_settings
  DROP CONSTRAINT IF EXISTS org_settings_payout_csv_format_check;

ALTER TABLE public.org_settings
  ADD CONSTRAINT org_settings_payout_csv_format_check
  CHECK (payout_csv_format IN ('zengin_simple', 'custom_basic', 'freee_vendor', 'zengin_standard'));

ALTER TABLE public.export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_status_check;

ALTER TABLE public.export_jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'full_backup',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS trigger_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.export_jobs
  ADD CONSTRAINT export_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'failed'));

ALTER TABLE public.export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_job_type_check;

ALTER TABLE public.export_jobs
  ADD CONSTRAINT export_jobs_job_type_check
  CHECK (job_type IN ('full_backup'));

ALTER TABLE public.export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_trigger_source_check;

ALTER TABLE public.export_jobs
  ADD CONSTRAINT export_jobs_trigger_source_check
  CHECK (trigger_source IN ('manual', 'cron', 'api'));

CREATE INDEX IF NOT EXISTS export_jobs_status_created_idx
  ON public.export_jobs(status, created_at ASC);

-- ---------------------------------------------------------------------------
-- 2) org_integration_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_integration_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  chatwork_api_token text,
  chatwork_default_room_id text,
  slack_webhook_url text,
  discord_webhook_url text,
  lark_webhook_url text,
  auto_digest_enabled boolean NOT NULL DEFAULT false,
  auto_invoice_reminders_enabled boolean NOT NULL DEFAULT false,
  auto_backup_enabled boolean NOT NULL DEFAULT false,
  digest_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminder_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  backup_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_integration_settings_digest_idx
  ON public.org_integration_settings(auto_digest_enabled)
  WHERE auto_digest_enabled = true;

CREATE INDEX IF NOT EXISTS org_integration_settings_reminder_idx
  ON public.org_integration_settings(auto_invoice_reminders_enabled)
  WHERE auto_invoice_reminders_enabled = true;

CREATE INDEX IF NOT EXISTS org_integration_settings_backup_idx
  ON public.org_integration_settings(auto_backup_enabled)
  WHERE auto_backup_enabled = true;

ALTER TABLE public.org_integration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_integration_settings_select_admin ON public.org_integration_settings;
CREATE POLICY org_integration_settings_select_admin
  ON public.org_integration_settings FOR SELECT
  USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS org_integration_settings_write_admin ON public.org_integration_settings;
CREATE POLICY org_integration_settings_write_admin
  ON public.org_integration_settings FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- 3) content review rounds / comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_review_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  round_no integer NOT NULL CHECK (round_no >= 1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'changes_requested', 'approved')),
  summary text,
  due_at date,
  reviewer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, round_no)
);

CREATE INDEX IF NOT EXISTS content_review_rounds_org_content_idx
  ON public.content_review_rounds(org_id, content_id, round_no DESC);

CREATE TABLE IF NOT EXISTS public.content_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.content_review_rounds(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  timecode_seconds integer CHECK (timecode_seconds IS NULL OR timecode_seconds >= 0),
  timecode_label text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_review_comments_round_idx
  ON public.content_review_comments(round_id, created_at ASC);

ALTER TABLE public.content_review_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_review_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_review_rounds_select_member ON public.content_review_rounds;
CREATE POLICY content_review_rounds_select_member
  ON public.content_review_rounds FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS content_review_rounds_write_contents_role ON public.content_review_rounds;
CREATE POLICY content_review_rounds_write_contents_role
  ON public.content_review_rounds FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

DROP POLICY IF EXISTS content_review_comments_select_member ON public.content_review_comments;
CREATE POLICY content_review_comments_select_member
  ON public.content_review_comments FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS content_review_comments_write_contents_role ON public.content_review_comments;
CREATE POLICY content_review_comments_write_contents_role
  ON public.content_review_comments FOR ALL
  USING (public.org_permission_enabled(org_id, 'contents_write'))
  WITH CHECK (public.org_permission_enabled(org_id, 'contents_write'));

-- ---------------------------------------------------------------------------
-- 4) vendor invoice evidence attachments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_invoice_evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_invoice_id uuid NOT NULL REFERENCES public.vendor_invoices(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_invoice_evidence_files_invoice_idx
  ON public.vendor_invoice_evidence_files(vendor_invoice_id, created_at DESC);

ALTER TABLE public.vendor_invoice_evidence_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_invoice_evidence_files_select_admin ON public.vendor_invoice_evidence_files;
CREATE POLICY vendor_invoice_evidence_files_select_admin
  ON public.vendor_invoice_evidence_files FOR SELECT
  USING (public.is_org_admin(org_id));

DROP POLICY IF EXISTS vendor_invoice_evidence_files_write_admin ON public.vendor_invoice_evidence_files;
CREATE POLICY vendor_invoice_evidence_files_write_admin
  ON public.vendor_invoice_evidence_files FOR ALL
  USING (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

INSERT INTO storage.buckets (id, name, public)
VALUES ('vendor-invoice-evidence', 'vendor-invoice-evidence', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS vendor_invoice_evidence_objects_select ON storage.objects;
DROP POLICY IF EXISTS vendor_invoice_evidence_objects_insert ON storage.objects;
DROP POLICY IF EXISTS vendor_invoice_evidence_objects_update ON storage.objects;
DROP POLICY IF EXISTS vendor_invoice_evidence_objects_delete ON storage.objects;

CREATE POLICY vendor_invoice_evidence_objects_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'vendor-invoice-evidence'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

CREATE POLICY vendor_invoice_evidence_objects_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'vendor-invoice-evidence'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

CREATE POLICY vendor_invoice_evidence_objects_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'vendor-invoice-evidence'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  )
  WITH CHECK (
    bucket_id = 'vendor-invoice-evidence'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

CREATE POLICY vendor_invoice_evidence_objects_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'vendor-invoice-evidence'
    AND auth.role() = 'authenticated'
    AND split_part(name, '/', 2) ~ '^[0-9a-fA-F-]{36}$'
    AND public.user_role_in_org(split_part(name, '/', 2)::uuid) IN ('owner', 'executive_assistant')
  );

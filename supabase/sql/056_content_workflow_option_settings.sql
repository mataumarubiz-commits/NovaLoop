ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS content_status_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_material_status_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_draft_status_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_final_status_options jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE public.campaigns DROP COLUMN IF EXISTS required_deliverables;

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS content_type_alignment_score NUMERIC(5,2);

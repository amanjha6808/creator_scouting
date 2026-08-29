-- Add metric columns to historical_benchmarks for richer benchmark data
ALTER TABLE public.historical_benchmarks ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0;
ALTER TABLE public.historical_benchmarks ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
ALTER TABLE public.historical_benchmarks ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0;
ALTER TABLE public.historical_benchmarks ADD COLUMN IF NOT EXISTS engagement_rate NUMERIC(7,4) DEFAULT 0;
ALTER TABLE public.historical_benchmarks ADD COLUMN IF NOT EXISTS profile_link TEXT;

-- Index for sorting by engagement
CREATE INDEX IF NOT EXISTS idx_benchmarks_engagement
  ON public.historical_benchmarks (engagement_rate DESC);

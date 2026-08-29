-- Create historical_benchmarks table for the benchmark management system
CREATE TABLE IF NOT EXISTS public.historical_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    creator_handle TEXT UNIQUE NOT NULL,
    creator_name TEXT,
    content_category TEXT NOT NULL,
    performance_tier TEXT CHECK (performance_tier IN ('High Performer', 'Average', 'Flop')) NOT NULL,
    reel_url TEXT,
    performance_notes TEXT
);

-- Enable Row Level Security (permissive for service role usage)
ALTER TABLE public.historical_benchmarks ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON public.historical_benchmarks
  FOR ALL USING (true) WITH CHECK (true);

-- Index for fast category + tier lookups used by the Gemini calibration engine
CREATE INDEX IF NOT EXISTS idx_benchmarks_category_tier
  ON public.historical_benchmarks (content_category, performance_tier);

-- Index for handle search / filtering
CREATE INDEX IF NOT EXISTS idx_benchmarks_handle
  ON public.historical_benchmarks (creator_handle);

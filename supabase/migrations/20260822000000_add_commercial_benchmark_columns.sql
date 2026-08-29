-- Add commercial cost & performance benchmarking columns
ALTER TABLE public.historical_benchmarks
  ADD COLUMN IF NOT EXISTS commercial_cost NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_view NUMERIC(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_efficiency_pct NUMERIC(7,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roi_rating TEXT DEFAULT '';

-- Index for sorting by CPV (best ROI first)
CREATE INDEX IF NOT EXISTS idx_benchmarks_cpv
  ON public.historical_benchmarks (cost_per_view ASC);

-- Index for sorting by reach efficiency
CREATE INDEX IF NOT EXISTS idx_benchmarks_reach
  ON public.historical_benchmarks (reach_efficiency_pct DESC);

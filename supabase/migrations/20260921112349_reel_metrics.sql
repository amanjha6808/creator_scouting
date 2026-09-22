CREATE TABLE public.instagram_reel_metrics (
  reel_url TEXT PRIMARY KEY,
  media_id TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);

ALTER TABLE public.instagram_reel_metrics ENABLE ROW LEVEL SECURITY;

-- The table is intentionally not granted to browser roles. Only server-side
-- route handlers using the service role can read or update Meta results.

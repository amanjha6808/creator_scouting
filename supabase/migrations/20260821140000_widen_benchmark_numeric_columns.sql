-- Widen numeric columns to prevent overflow from large CSV datasets.
-- BIGINT supports up to 9.2 quintillion — handles any realistic view/follower count.
-- Unconstrained NUMERIC removes the (7,4) precision limit on engagement rates.

ALTER TABLE public.historical_benchmarks
  ALTER COLUMN views TYPE BIGINT USING views::bigint,
  ALTER COLUMN views SET DEFAULT 0;

ALTER TABLE public.historical_benchmarks
  ALTER COLUMN likes TYPE BIGINT USING likes::bigint,
  ALTER COLUMN likes SET DEFAULT 0;

ALTER TABLE public.historical_benchmarks
  ALTER COLUMN comments TYPE BIGINT USING comments::bigint,
  ALTER COLUMN comments SET DEFAULT 0;

ALTER TABLE public.historical_benchmarks
  ALTER COLUMN engagement_rate TYPE NUMERIC USING engagement_rate::numeric,
  ALTER COLUMN engagement_rate SET DEFAULT 0;

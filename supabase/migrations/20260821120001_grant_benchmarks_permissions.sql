-- Grant table-level permissions to Supabase roles for historical_benchmarks.
-- "permission denied for table" is a GRANT issue, not RLS — the anon/authenticated
-- roles must be explicitly granted access to any new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_benchmarks
  TO anon, authenticated, service_role;

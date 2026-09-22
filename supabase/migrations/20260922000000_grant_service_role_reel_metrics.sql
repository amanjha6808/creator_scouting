-- The metrics cache is server-side only: grant the service role (used by the
-- deployed route handlers) read/write access, and never the browser roles
-- (anon / authenticated).
GRANT SELECT, INSERT, UPDATE ON public.instagram_reel_metrics TO service_role;

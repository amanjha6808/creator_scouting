CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    title TEXT NOT NULL,
    brief_description TEXT NOT NULL,
    content_type TEXT NOT NULL,
    red_flags TEXT[]
);

CREATE TABLE IF NOT EXISTS public.creators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    instagram_handle TEXT UNIQUE NOT NULL,
    name TEXT,
    followers_count INT,
    avg_engagement_rate NUMERIC(5,2),
    bio TEXT,
    recent_posts_json JSONB
);

-- Ensure name column exists if creators table already existed
ALTER TABLE public.creators ADD COLUMN IF NOT EXISTS name TEXT;

CREATE TABLE IF NOT EXISTS public.analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES public.creators(id) ON DELETE CASCADE,
    overall_relevance_score NUMERIC(5,2) NOT NULL,
    post_evidence_reasoning TEXT NOT NULL
);

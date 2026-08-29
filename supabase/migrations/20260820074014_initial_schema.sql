CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    title TEXT NOT NULL,
    brief_description TEXT NOT NULL,
    required_deliverables TEXT[],
    red_flags TEXT[],
    target_keywords TEXT[]
);

CREATE TABLE IF NOT EXISTS public.creators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    instagram_handle TEXT UNIQUE NOT NULL,
    ig_user_id TEXT,
    followers_count INT,
    media_count INT,
    avg_engagement_rate NUMERIC(5,2),
    bio TEXT,
    recent_posts_json JSONB
);

CREATE TABLE IF NOT EXISTS public.analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES public.creators(id) ON DELETE CASCADE,
    overall_relevance_score NUMERIC(5,2) NOT NULL,
    semantic_match_score NUMERIC(5,2),
    engagement_health_score NUMERIC(5,2),
    red_flags_detected TEXT[],
    scoring_reasoning TEXT NOT NULL
);

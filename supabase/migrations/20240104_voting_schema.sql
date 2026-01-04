-- Create table for tracking user reputation and shadowban status
CREATE TABLE IF NOT EXISTS public.user_reputation (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Ideally maps to auth.users if auth is used, otherwise generated
    reputation_score FLOAT DEFAULT 1.0,
    total_votes INT DEFAULT 0,
    correct_votes INT DEFAULT 0,
    is_shadowbanned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create table for individual channel votes
CREATE TABLE IF NOT EXISTS public.channel_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_reputation(user_id), -- Link to reputation table
    vote BOOLEAN NOT NULL, -- TRUE for AI, FALSE for Human
    weight FLOAT NOT NULL DEFAULT 1.0,
    is_shadowbanned BOOLEAN DEFAULT FALSE, -- Snapshot at time of voting
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_channel_votes_channel_id ON public.channel_votes(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_votes_user_id ON public.channel_votes(user_id);

-- RLS Policies (assuming anonymous access for now, but good practice)
ALTER TABLE public.user_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_votes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert votes (controlled via Edge Function mostly)
CREATE POLICY "Enable insert for everyone" ON public.channel_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable read for everyone" ON public.channel_votes FOR SELECT USING (true);

-- Allow anyone to read reputation (maybe restrict this in production)
CREATE POLICY "Enable read for everyone" ON public.user_reputation FOR SELECT USING (true);

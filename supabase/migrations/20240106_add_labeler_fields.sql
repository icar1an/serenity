-- Add missing columns to help the labeler display channel information
ALTER TABLE public.channels 
ADD COLUMN IF NOT EXISTS channel_title TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS sample_video_id TEXT,
ADD COLUMN IF NOT EXISTS sample_thumbnail TEXT,
ADD COLUMN IF NOT EXISTS sample_title TEXT,
ADD COLUMN IF NOT EXISTS sample_description TEXT;

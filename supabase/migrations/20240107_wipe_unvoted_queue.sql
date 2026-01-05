-- Migration: Wipe unvoted channel queue
-- This removes all channels that do not have any votes yet, effectively resetting the labeler queue
-- and resolving duplicate key conflicts for those channels.

DELETE FROM public.channels
WHERE id NOT IN (
    SELECT DISTINCT channel_id 
    FROM public.channel_votes
);

-- Optional: For the REMAINING channels (those with votes), 
-- try to clean their IDs but ignore duplicates (keep the broken one if a clean one exists)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT id, youtube_channel_id, handle 
        FROM public.channels 
        WHERE youtube_channel_id ~ '^(/+(channel|user|c)/+|[\s/@]+)+'
           OR youtube_channel_id ~ '/+$'
    LOOP
        BEGIN
            UPDATE public.channels
            SET 
                youtube_channel_id = regexp_replace(
                    regexp_replace(youtube_channel_id, '^(/+(channel|user|c)/+|[\s/@]+)+', '', 'gi'),
                    '/+$', '', 'g'
                ),
                handle = regexp_replace(
                    regexp_replace(handle, '^(/+(channel|user|c)/+|[\s/@]+)+', '', 'gi'),
                    '/+$', '', 'g'
                )
            WHERE id = r.id;
        EXCEPTION WHEN unique_violation THEN
            -- If a clean version already exists, we just leave this one as is (it has votes, so we don't want to delete it easily without merging)
            -- Or we could merge, but that is complex. For now, just skip.
            NULL;
        END;
    END LOOP;
END $$;

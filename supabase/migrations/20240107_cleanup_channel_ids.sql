-- Migration: Cleanup broken channel IDs and handles
-- Fixes structural errors like /@/@handle, /channel/UC..., etc.

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
WHERE 
    youtube_channel_id ~ '^(/+(channel|user|c)/+|[\s/@]+)+'
    OR youtube_channel_id ~ '/+$'
    OR handle ~ '^(/+(channel|user|c)/+|[\s/@]+)+'
    OR handle ~ '/+$';

-- Also clean up any potential null string representations
UPDATE public.channels
SET handle = NULL
WHERE handle = 'null' OR handle = 'undefined' OR handle = '(unknown)';

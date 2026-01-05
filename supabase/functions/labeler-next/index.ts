
import { createClient } from "@supabase/supabase-js"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manual-labeler-token',
}

function normalizeId(id: string): string {
    if (!id) return id;
    // Aggressively strip multiple leading slashes, @ symbols, and various YouTube path prefixes
    // This handles: /@handle, @@handle, /@/@handle, /channel/UC..., //channel//UC..., etc.
    return id.trim().replace(/^(\/?(?:channel|user|c)\/|[\s/@]+)+/i, '').replace(/\/+$/, '');
}

function cleanValue(val: any): any {
    if (typeof val === 'string') {
        const cleaned = val.trim();
        if (cleaned.toLowerCase() === '(unknown)' || cleaned === 'null' || cleaned === 'undefined') {
            return null;
        }
        return cleaned;
    }
    return val;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Validate Token
        const token = req.headers.get('x-manual-labeler-token');
        const validToken = Deno.env.get('MANUAL_LABELER_TOKEN');

        if (!validToken || token !== validToken) {
            console.error('Invalid token provided');
            // For user friendliness/debugging we might return a specific error, 
            // but strictly 401/403 is better. 
            // Given the context, we'll throw an error.
            throw new Error('Unauthorized: Invalid labeler token');
        }

        const url = new URL(req.url)
        const labelerId = url.searchParams.get('labeler_id')

        if (!labelerId) {
            throw new Error('Missing labeler_id')
        }

        // 2. Get User ID (Resolution/Creation logic duplicated from vote-channel for consistency, or just assume passed ID is enough for lookup)
        // We need to know which channels this user has ALREADY voted on.
        // The user identifier passed might be the UUID from local storage.

        let userId = labelerId;

        // Find user by this ID
        const { data: userRep } = await supabaseClient
            .from('user_reputation')
            .select('user_id')
            .eq('user_id', userId)
            .single()

        // If user doesn't exist yet, that's fine, they haven't voted on anything.
        const internalUserId = userRep ? userRep.user_id : userId;

        // 3. Find a channel not voted on by this user
        // We want a random channel from 'channels' where id NOT IN (select channel_id from channel_votes where user_id = internalUserId)

        // Supabase/PostgREST doesn't support easy "NOT IN" subquery for random selection efficiently in one go via JS client without RPC.
        // But we can try a left join approach or stored procedure.
        // For simplicity in this Edge Function without SQL modification rights:
        // We will fetch a batch of channels and filter in memory (not scalable but works for MVP/small scale), 
        // OR better: use the `not.in` filter with a list of IDs.

        // Strategy: Get IDs user has voted on.
        const { data: votedVotes } = await supabaseClient
            .from('channel_votes')
            .select('channel_id')
            .eq('user_id', internalUserId)

        const votedChannelIds = votedVotes ? votedVotes.map((v: { channel_id: string }) => v.channel_id) : [];

        // Fetch candidates
        let query = supabaseClient
            .from('channels')
            .select('*') // Use * to avoid crash if specific columns don't exist yet
            .limit(50) // Fetch a batch

        if (votedChannelIds.length > 0) {
            // Note: If voted list is huge, this URL param approach fails. 
            // Better to use an RPC 'get_next_channel_for_user(user_uuid)'. 
            // But I cannot easily create RPCs here. 
            // Retry logic: Fetch random, check if voted.

            // Should properly be:
            // .not('id', 'in', `(${votedChannelIds.join(',')})`)
            // But for safety let's just use the filter
            query = query.not('id', 'in', votedChannelIds)
        }

        // Randomize isn't easy via API. We'll pick one from the batch properly.
        const { data: candidates, error: candidatesError } = await query;

        if (candidatesError) throw candidatesError;

        if (!candidates || candidates.length === 0) {
            return new Response(
                JSON.stringify({ ok: false, error: 'empty_queue' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Pick random from candidates
        const item = candidates[Math.floor(Math.random() * candidates.length)];

        // Format for frontend
        const channelTitle = cleanValue(item.channel_title);
        const handle = item.handle ? normalizeId(item.handle) : null;
        const fallbackTitle = handle ? `@${handle}` : normalizeId(item.youtube_channel_id);

        const responseItem = {
            id: item.id, // The UUID for voting
            youtube_channel_id: normalizeId(item.youtube_channel_id),
            channel_title: channelTitle || fallbackTitle,
            handle: handle,
            sample_video_id: cleanValue(item.sample_video_id),
            sample_thumbnail: cleanValue(item.sample_thumbnail) || (item.sample_video_id ? `https://i.ytimg.com/vi/${item.sample_video_id}/hqdefault.jpg` : null),
            sample_title: cleanValue(item.sample_title) || channelTitle || fallbackTitle,
            sample_description: cleanValue(item.sample_description) || cleanValue(item.description)
        };

        return new Response(
            JSON.stringify({ ok: true, item: responseItem }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ ok: false, error: (error as Error).message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})

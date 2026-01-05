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

function cleanMetadata(val: any): any {
    if (typeof val === 'string') {
        const cleaned = val.trim();
        if (cleaned.toLowerCase() === '(unknown)' || cleaned === 'null' || cleaned === 'undefined') {
            return null;
        }
        return cleaned;
    }
    return val;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Validate Token
        const token = req.headers.get('x-manual-labeler-token');
        const validToken = Deno.env.get('MANUAL_LABELER_TOKEN');

        if (!validToken || token !== validToken) {
            throw new Error('Unauthorized: Invalid labeler token');
        }

        const {
            channel_id: passedChannelId,
            youtube_channel_id: raw_youtube_channel_id,
            user_identifier,
            is_ai,
            metadata // Optional metadata to save
        } = await req.json()

        const youtube_channel_id = normalizeId(raw_youtube_channel_id);
        const handle = metadata?.handle ? normalizeId(metadata.handle) : undefined;
        if (metadata) metadata.handle = handle;

        if ((!passedChannelId && !youtube_channel_id) || is_ai === undefined) {
            throw new Error('Missing required fields: provide channel_id or youtube_channel_id')
        }

        let channel_id = passedChannelId;

        // 0. Resolve channel_id if not provided (manual entry fallback)
        if (!channel_id && youtube_channel_id) {
            // Check if channel exists
            const { data: existing, error: fetchError } = await supabaseClient
                .from('channels')
                .select('id')
                .eq('youtube_channel_id', youtube_channel_id)
                .maybeSingle();

            if (existing) {
                channel_id = existing.id;
            } else {
                // Create it
                const { data: created, error: createError } = await supabaseClient
                    .from('channels')
                    .insert({
                        youtube_channel_id,
                        handle: handle
                    })
                    .select('id')
                    .single();

                if (createError) throw createError;
                channel_id = created.id;
            }
        }

        // 1. Get or Initialize User Reputation
        // In a real app with Auth, we'd use req.auth.user.id. 
        // Here we might use a client-generated UUID passed as user_identifier, or rely on Auth.
        // implementing flexible check:
        let userId = user_identifier;

        // Check if user exists
        let { data: userRep, error: userError } = await supabaseClient
            .from('user_reputation')
            .select('*')
            .eq('user_id', userId)
            .single()

        if (!userRep) {
            // Create new user record
            const { data: newUser, error: createError } = await supabaseClient
                .from('user_reputation')
                .insert({ user_id: userId }) // If userId is supplied
                .select()
                .single()

            if (createError) {
                // If insert failed (maybe race condition or generated ID mismatch), try fetching again or fail
                // For simplicity, assuming success or simple error
                throw createError
            }
            userRep = newUser
        }

        // 1.5 Update Channel metadata if provided
        if (metadata) {
            const allowedMetadata = [
                'channel_title',
                'description',
                'sample_video_id',
                'sample_thumbnail',
                'sample_title',
                'sample_description'
            ];

            const metadataToUpdate: Record<string, any> = {};
            for (const key of allowedMetadata) {
                if (metadata[key] !== undefined) {
                    metadataToUpdate[key] = metadata[key];
                }
            }

            if (Object.keys(metadataToUpdate).length > 0) {
                // Clean "(unknown)" and other placeholder strings
                const cleanedUpdate: Record<string, any> = {};
                for (const key in metadataToUpdate) {
                    const cleaned = cleanMetadata(metadataToUpdate[key]);
                    if (cleaned !== null) {
                        cleanedUpdate[key] = cleaned;
                    }
                }

                if (Object.keys(cleanedUpdate).length > 0) {
                    await supabaseClient
                        .from('channels')
                        .update(cleanedUpdate)
                        .eq('id', channel_id);
                }
            }
        }

        // 2. Calculate Weight
        let weight = 1.0;

        if (userRep.is_shadowbanned) {
            weight = 0;
        } else {
            // Decaying weight based on existing vote count for this channel
            const { count, error: countError } = await supabaseClient
                .from('channel_votes')
                .select('*', { count: 'exact', head: true })
                .eq('channel_id', channel_id)

            const voteCount = count || 0;
            // Formula: Weight decreases as more people vote.
            // Starts at 1.0. 
            // Example: max(0.1, 1.0 - (log10(voteCount + 1) * 0.2))
            // 0 votes -> 1.0
            // 9 votes -> 0.8
            // 99 votes -> 0.6
            weight = Math.max(0.1, 1.0 - (Math.log10(voteCount + 1) * 0.2));
        }

        // 3. Record Vote
        const { error: voteError } = await supabaseClient
            .from('channel_votes')
            .insert({
                channel_id: channel_id,
                user_id: userRep.user_id,
                vote: is_ai,
                weight: weight,
                is_shadowbanned: userRep.is_shadowbanned
            })

        if (voteError) throw voteError

        // 4. Update Channel Classification (Optional: can be done via Trigger)
        // We calculate the weighted average.
        // Get all votes for channel
        const { data: votes, error: votesError } = await supabaseClient
            .from('channel_votes')
            .select('vote, weight')
            .eq('channel_id', channel_id)
            .eq('is_shadowbanned', false) // Ignore shadowbanned votes in calculation

        if (votes && votes.length > 0) {
            let weightedSum = 0;
            let totalWeight = 0;

            votes.forEach(v => {
                const val = v.vote ? 1 : 0;
                weightedSum += val * v.weight;
                totalWeight += v.weight;
            });

            if (totalWeight > 0) {
                const score = weightedSum / totalWeight;
                // If score > 0.6 => AI. If < 0.4 => Human. Else Mixed/Unknown
                // For now, let's just update the predictions table if we have one, or channels table
                // Updating 'channels' table feature_vector or metadata?
                // The user wanted to "rate channels as AI or not".
                // Let's assume we update a 'classification' field or similar in channels or predictions.

                // For this implementation, we will log a new prediction
                const isAiConsensus = score > 0.6;

                await supabaseClient
                    .from('channel_predictions')
                    .insert({
                        channel_id: channel_id,
                        is_ai: isAiConsensus,
                        confidence: Math.max(score, 1 - score), // Simple confidence
                        model_version: 'consensus-v1'
                    })
            }
        }

        return new Response(
            JSON.stringify({ success: true, weight_assigned: weight }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: (error as Error).message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})

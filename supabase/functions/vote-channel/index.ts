import { createClient } from "@supabase/supabase-js"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manual-labeler-token',
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

        const { channel_id, user_identifier, is_ai } = await req.json()

        if (!channel_id || is_ai === undefined) {
            throw new Error('Missing required fields')
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

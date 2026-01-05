/**
 * Supabase Gateway for Serenity
 * TypeScript port of clarity's db.py SupabaseGateway
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration loaded from environment/config
interface SupabaseConfig {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    supabaseServiceRoleKey?: string;
    predictionsTable: string;
    channelsTable: string;
    feedbackTable: string;
}

// Default configuration - values should be set via config.ts or environment
const defaultConfig: SupabaseConfig = {
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    supabaseServiceRoleKey: undefined,
    predictionsTable: 'channel_predictions',
    channelsTable: 'channels',
    feedbackTable: 'prediction_feedback',
};

export interface PredictionLog {
    isAi: boolean;
    confidence: number;
    modelVersion: string;
    youtubeChannelId: string;
    channelHandle?: string;
    context?: Record<string, unknown>;
}

export interface ChannelData {
    id?: string;
    youtube_channel_id: string;
    handle?: string;
    channel_metadata?: Record<string, unknown>;
    feature_vector?: Record<string, number>;
    tags?: string[];
    // New metadata columns
    channel_title?: string;
    description?: string;
    sample_video_id?: string;
    sample_thumbnail?: string;
    sample_title?: string;
    sample_description?: string;
}

export interface CachedAnalysis {
    traits: Record<string, unknown>;
    features: Record<string, number>;
    prediction: {
        pred: number;
        proba: number;
        features: Record<string, number>;
    };
    cached: boolean;
}

class SupabaseGateway {
    private client: SupabaseClient | null = null;
    private config: SupabaseConfig;

    constructor(config?: Partial<SupabaseConfig>) {
        this.config = { ...defaultConfig, ...config };
        this.initializeClient();
    }

    private initializeClient(): void {
        const { supabaseUrl, supabaseAnonKey } = this.config;

        if (!supabaseUrl || !supabaseAnonKey) {
            console.info('[Serenity] Supabase credentials missing; persistence disabled.');
            return;
        }

        try {
            this.client = createClient(supabaseUrl, supabaseAnonKey);
            console.info('[Serenity] Supabase client initialized successfully.');
        } catch (error) {
            console.error('[Serenity] Failed to initialize Supabase client:', error);
            this.client = null;
        }
    }

    isEnabled(): boolean {
        return this.client !== null;
    }

    /**
     * Get or create a channel record and return its UUID.
     */
    async getOrCreateChannel(
        youtubeChannelId: string,
        handle?: string,
        channelMetadata?: Record<string, unknown>,
        featureVector?: Record<string, number>,
        additionalMetadata?: Partial<Omit<ChannelData, 'id' | 'youtube_channel_id' | 'handle' | 'channel_metadata' | 'feature_vector' | 'tags'>>
    ): Promise<string | null> {
        if (!this.isEnabled() || !this.client) {
            return null;
        }

        if (!youtubeChannelId) {
            throw new Error('youtube_channel_id is required');
        }

        // Try to get existing channel
        try {
            const { data, error } = await this.client
                .from(this.config.channelsTable)
                .select('id')
                .eq('youtube_channel_id', youtubeChannelId)
                .limit(1);

            if (error) {
                console.warn('[Serenity] Failed fetching channel:', error);
            } else if (data && data.length > 0) {
                return data[0].id;
            }
        } catch (error) {
            console.warn('[Serenity] Failed fetching channel:', error);
        }

        // Channel doesn't exist, create it
        const payload: Record<string, unknown> = {
            youtube_channel_id: youtubeChannelId,
        };

        if (handle !== undefined) {
            payload.handle = handle;
        }
        if (channelMetadata !== undefined) {
            payload.channel_metadata = channelMetadata;
        }
        if (featureVector !== undefined) {
            payload.feature_vector = featureVector;
        }

        // Add additional metadata if provided
        if (additionalMetadata) {
            Object.assign(payload, additionalMetadata);
        }

        try {
            const { data, error } = await this.client
                .from(this.config.channelsTable)
                .insert(payload)
                .select('id');

            if (error) {
                console.error('[Serenity] Failed creating channel:', error);
                return null;
            }

            if (data && data.length > 0) {
                return data[0].id;
            }
        } catch (error) {
            console.error('[Serenity] Failed creating channel:', error);
            return null;
        }

        return null;
    }

    /**
     * Log a prediction to channel_predictions table.
     */
    async logPrediction(log: PredictionLog): Promise<void> {
        if (!this.isEnabled() || !this.client) {
            console.debug('[Serenity] Skipping Supabase log (gateway disabled).');
            return;
        }

        // Get or create channel to get its UUID
        const channelUuid = await this.getOrCreateChannel(
            log.youtubeChannelId,
            log.channelHandle
        );

        if (!channelUuid) {
            console.warn('[Serenity] Failed to get/create channel for prediction logging');
            return;
        }

        // Insert prediction
        const payload = {
            channel_id: channelUuid,
            is_ai: log.isAi,
            confidence: log.confidence,
            model_version: log.modelVersion,
            context: log.context,
        };

        try {
            const { error } = await this.client
                .from(this.config.predictionsTable)
                .insert(payload);

            if (error) {
                console.error('[Serenity] Failed logging prediction:', error);
            }
        } catch (error) {
            console.error('[Serenity] Failed logging prediction:', error);
        }
    }

    /**
     * Get a channel record by youtube_channel_id or handle.
     */
    async getChannel(
        youtubeChannelId?: string,
        handle?: string
    ): Promise<ChannelData | null> {
        if (!this.isEnabled() || !this.client) {
            return null;
        }

        if (!youtubeChannelId && !handle) {
            return null;
        }

        let query = this.client.from(this.config.channelsTable).select('*');

        if (youtubeChannelId) {
            query = query.eq('youtube_channel_id', youtubeChannelId);
        } else if (handle) {
            query = query.eq('handle', handle);
        }

        try {
            const { data, error } = await query.limit(1);

            if (error) {
                console.warn('[Serenity] Failed fetching channel:', error);
                return null;
            }

            if (data && data.length > 0) {
                return data[0] as ChannelData;
            }
        } catch (error) {
            console.warn('[Serenity] Failed fetching channel:', error);
        }

        return null;
    }

    /**
     * Retrieve cached channel analysis from Supabase if available.
     */
    async getCachedAnalysis(
        youtubeChannelId?: string,
        handle?: string
    ): Promise<CachedAnalysis | null> {
        if (!this.isEnabled() || !this.client) {
            return null;
        }

        if (!youtubeChannelId && !handle) {
            return null;
        }

        // Get channel
        const channel = await this.getChannel(youtubeChannelId, handle);
        if (!channel || !channel.id) {
            return null;
        }

        // Get latest prediction from channel_predictions
        try {
            const { data, error } = await this.client
                .from(this.config.predictionsTable)
                .select('*')
                .eq('channel_id', channel.id)
                .order('created_at', { ascending: false })
                .limit(1);

            if (error || !data || data.length === 0) {
                return null;
            }

            const predictionData = data[0];
            const channelMetadata = channel.channel_metadata || {};
            const featureVector = channel.feature_vector || {};

            // Convert is_ai boolean to pred int (1 = AI, 0 = non-AI) for compatibility
            const isAi = predictionData.is_ai;
            const pred = isAi ? 1 : 0;

            return {
                traits: {
                    channel_name: channel.handle || handle,
                    id: channel.youtube_channel_id || youtubeChannelId,
                    ...channelMetadata,
                },
                features: featureVector,
                prediction: {
                    pred,
                    proba: predictionData.confidence || 0.0,
                    features: featureVector,
                },
                cached: true,
            };
        } catch (error) {
            console.warn('[Serenity] Failed fetching cached analysis:', error);
            return null;
        }
    }

    /**
     * Upsert a channel record in the channels table.
     */
    async upsertChannel(
        youtubeChannelId: string,
        handle?: string,
        channelMetadata?: Record<string, unknown>,
        featureVector?: Record<string, number>,
        tags?: string[],
        additionalMetadata?: Partial<Omit<ChannelData, 'id' | 'youtube_channel_id' | 'handle' | 'channel_metadata' | 'feature_vector' | 'tags'>>
    ): Promise<void> {
        if (!this.isEnabled() || !this.client) {
            console.debug('[Serenity] Skipping Supabase channel upsert (gateway disabled).');
            return;
        }

        if (!youtubeChannelId) {
            throw new Error('youtube_channel_id is required');
        }

        const payload: Record<string, unknown> = {
            youtube_channel_id: youtubeChannelId,
        };

        if (handle !== undefined) {
            payload.handle = handle;
        }
        if (channelMetadata !== undefined) {
            payload.channel_metadata = channelMetadata;
        }
        if (featureVector !== undefined) {
            payload.feature_vector = featureVector;
        }
        if (tags !== undefined) {
            payload.tags = tags;
        }

        // Add additional metadata if provided
        if (additionalMetadata) {
            Object.assign(payload, additionalMetadata);
        }

        try {
            const { error } = await this.client
                .from(this.config.channelsTable)
                .upsert(payload, { onConflict: 'youtube_channel_id' });

            if (error) {
                console.error('[Serenity] Failed upserting channel:', error);
            }
        } catch (error) {
            console.error('[Serenity] Failed upserting channel:', error);
        }
    }

    /**
     * List channels that are flagged as AI/low-effort.
     */
    async listBlockedChannels(
        limit = 100,
        minConfidence = 0.0
    ): Promise<Array<Record<string, unknown>>> {
        if (!this.isEnabled() || !this.client) {
            console.debug('[Serenity] Skipping Supabase query (gateway disabled).');
            return [];
        }

        try {
            // Query predictions where is_ai=True
            const { data, error } = await this.client
                .from(this.config.predictionsTable)
                .select('*')
                .eq('is_ai', true)
                .gte('confidence', minConfidence)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error || !data) {
                console.error('[Serenity] Failed to list blocked channels:', error);
                return [];
            }

            // Get unique channel UUIDs and fetch channel info
            const channelUuids = Array.from(new Set(data.map(pred => pred.channel_id).filter(Boolean)));
            if (channelUuids.length === 0) {
                return [];
            }

            // Fetch channels in batch
            const { data: channelsData, error: channelsError } = await this.client
                .from(this.config.channelsTable)
                .select('id, youtube_channel_id, handle, channel_metadata')
                .in('id', channelUuids);

            if (channelsError || !channelsData) {
                console.error('[Serenity] Failed to fetch channels:', channelsError);
                return [];
            }

            // Create a lookup map
            const channelsMap = new Map<string, typeof channelsData[0]>(
                channelsData.map(ch => [ch.id, ch])
            );

            // Combine predictions with channel info
            return data.map(pred => {
                const channel = channelsMap.get(pred.channel_id);
                return {
                    channel_id: channel?.youtube_channel_id,
                    handle: channel?.handle,
                    channel_metadata: channel?.channel_metadata || {},
                    is_ai: pred.is_ai,
                    confidence: pred.confidence || 0.0,
                    model_version: pred.model_version,
                    predicted_at: pred.created_at,
                    context: pred.context,
                };
            });
        } catch (error) {
            console.error('[Serenity] Failed to list blocked channels:', error);
            return [];
        }
    }

    /**
     * Submit user feedback on a prediction.
     */
    async submitFeedback(
        youtubeChannelId: string,
        userFeedback: 'correct' | 'incorrect',
        userComment?: string
    ): Promise<void> {
        if (!this.isEnabled() || !this.client) {
            console.debug('[Serenity] Skipping Supabase feedback (gateway disabled).');
            return;
        }

        // Get channel UUID
        const channel = await this.getChannel(youtubeChannelId);
        if (!channel || !channel.id) {
            console.warn('[Serenity] Channel not found for feedback');
            return;
        }

        const payload = {
            channel_id: channel.id,
            feedback: userFeedback,
            comment: userComment,
        };

        try {
            const { error } = await this.client
                .from(this.config.feedbackTable)
                .insert(payload);

            if (error) {
                console.error('[Serenity] Failed submitting feedback:', error);
            }
        } catch (error) {
            console.error('[Serenity] Failed submitting feedback:', error);
        }
    }

    /**
     * Get the latest prediction for a channel (simple is_ai lookup).
     * @param youtubeChannelId - The YouTube channel ID (UC... format)
     * @param handle - Optional channel handle (@username format)
     * @returns Prediction result with isAi boolean and confidence, or null if not found
     */
    async getChannelPrediction(
        youtubeChannelId?: string,
        handle?: string
    ): Promise<{ isAi: boolean; confidence: number; modelVersion?: string } | null> {
        if (!this.isEnabled() || !this.client) {
            return null;
        }

        if (!youtubeChannelId && !handle) {
            return null;
        }

        // Get channel first
        const channel = await this.getChannel(youtubeChannelId, handle);
        if (!channel || !channel.id) {
            return null;
        }

        try {
            const { data, error } = await this.client
                .from(this.config.predictionsTable)
                .select('is_ai, confidence, model_version')
                .eq('channel_id', channel.id)
                .order('created_at', { ascending: false })
                .limit(1);

            if (error || !data || data.length === 0) {
                return null;
            }

            const prediction = data[0];
            return {
                isAi: prediction.is_ai,
                confidence: prediction.confidence || 0,
                modelVersion: prediction.model_version,
            };
        } catch (error) {
            console.warn('[Serenity] Failed fetching channel prediction:', error);
            return null;
        }
    }

    /**
     * Submit a vote for a channel (AI vs Human).
     * Calls the 'vote-channel' Edge Function.
     */
    async submitChannelVote(
        youtubeChannelId: string,
        isAi: boolean,
        userIdentifier?: string
    ): Promise<{ success: boolean; weight?: number; error?: string }> {
        if (!this.isEnabled() || !this.client) {
            return { success: false, error: 'Supabase not enabled' };
        }

        // Get channel UUID
        const channelId = await this.getOrCreateChannel(youtubeChannelId);
        if (!channelId) {
            return { success: false, error: 'Could not resolve channel ID' };
        }

        try {
            // Call Edge Function
            const { data, error } = await this.client.functions.invoke('vote-channel', {
                body: {
                    channel_id: channelId,
                    user_identifier: userIdentifier || 'anonymous', // TODO: Use real user ID if available
                    is_ai: isAi
                }
            });

            if (error) {
                console.error('[Serenity] Vote submission failed:', error);
                return { success: false, error: error.message };
            }

            return { success: true, weight: data.weight_assigned };
        } catch (error) {
            console.error('[Serenity] Vote submission error:', error);
            return { success: false, error: error.message };
        }
    }
}

// Singleton instance
let gatewayInstance: SupabaseGateway | null = null;

/**
 * Get the Supabase gateway instance.
 * Initialize with config on first call.
 */
export function getSupabaseGateway(config?: Partial<SupabaseConfig>): SupabaseGateway {
    if (!gatewayInstance) {
        gatewayInstance = new SupabaseGateway(config);
    }
    return gatewayInstance;
}

/**
 * Initialize the Supabase gateway with configuration.
 * Call this at app startup with your Supabase credentials.
 */
export function initializeSupabase(config: Partial<SupabaseConfig>): SupabaseGateway {
    gatewayInstance = new SupabaseGateway(config);
    return gatewayInstance;
}

export { SupabaseGateway };

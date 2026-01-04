/**
 * AI Classification types for Serenity
 */

// Classification levels for YouTube channels
export type AIClassification = "ai_generated" | "human_created" | "ai_assisted" | "mixed" | "unknown";

// Channel classification data structure
export interface ChannelClassification {
    channelId: string;
    handle: string;
    classification: AIClassification;
}

// User preferences for hiding AI content
export interface HidePreferences {
    hideAIChannels: boolean;
    hideAIAssistedChannels: boolean;
    hideMixedChannels: boolean;
}

// Export for use in other modules
export type ChannelHandle = string;

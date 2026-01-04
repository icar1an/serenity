/**
 * Channel classification lookup service
 * Priority order: Manual Overrides > Database > Bundled JSON
 */

import { AIClassification, ChannelHandle } from "../types/aiClassification";
import { getOverride } from "./manualOverrides";
import { getSupabaseGateway } from "./supabase";

// In-memory cache of bundled channel classifications
let channelData: Record<ChannelHandle, AIClassification> | null = null;

// In-memory cache for database lookups (reduces DB queries)
const dbCache = new Map<string, { classification: AIClassification | null; timestamp: number }>();
const DB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load channel classification data from bundled JSON (fallback)
 */
async function loadChannelData(): Promise<Record<ChannelHandle, AIClassification>> {
    if (channelData !== null) {
        return channelData;
    }

    try {
        const response = await fetch(chrome.runtime.getURL("channelData.json"));
        if (!response.ok) {
            console.error("[Serenity] Failed to load channel data:", response.status);
            channelData = {};
            return channelData;
        }

        channelData = await response.json();
        console.log(`[Serenity] Loaded ${Object.keys(channelData!).length} bundled channel classifications`);
        return channelData!;
    } catch (e) {
        console.error("[Serenity] Error loading channel data:", e);
        channelData = {};
        return channelData;
    }
}

/**
 * Normalize a channel handle for lookup
 * Handles various formats: @handle, /@handle, handle, URL-encoded handles
 */
function normalizeHandle(handle: string): ChannelHandle {
    let normalized = handle.trim();

    // URL decode if needed
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // Ignore decode errors
    }

    // Remove leading @ or /@
    if (normalized.startsWith("/@")) {
        normalized = normalized.slice(2);
    } else if (normalized.startsWith("@")) {
        normalized = normalized.slice(1);
    }

    return normalized.toLowerCase();
}

/**
 * Get classification from database
 */
async function getClassificationFromDB(
    channelId?: string,
    handle?: string
): Promise<AIClassification | null> {
    const cacheKey = channelId || handle || "";

    // Check cache first
    const cached = dbCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DB_CACHE_TTL_MS) {
        return cached.classification;
    }

    try {
        const gateway = getSupabaseGateway();
        if (!gateway.isEnabled()) {
            return null;
        }

        const prediction = await gateway.getChannelPrediction(channelId, handle);
        if (!prediction) {
            dbCache.set(cacheKey, { classification: null, timestamp: Date.now() });
            return null;
        }

        // Convert is_ai boolean to AIClassification type
        const classification: AIClassification = prediction.isAi ? "ai_generated" : "human_created";
        dbCache.set(cacheKey, { classification, timestamp: Date.now() });

        console.log(`[Serenity] DB classification for ${cacheKey}: ${classification}`);
        return classification;
    } catch (error) {
        console.warn("[Serenity] Error fetching from database:", error);
        return null;
    }
}

/**
 * Get classification for a channel by handle
 * Priority: Manual Override > Database > Bundled JSON
 * @param handle - The channel handle (with or without @)
 * @param channelId - Optional YouTube channel ID (UC... format)
 * @returns The classification or null if unknown
 */
export async function getChannelClassification(
    handle: string,
    channelId?: string
): Promise<AIClassification | null> {
    const normalized = normalizeHandle(handle);

    // 1. Check manual override first
    const override = await getOverride(channelId || normalized);
    if (override === 'block') {
        return "ai_generated"; // Treat as AI to trigger hiding
    }
    if (override === 'allow') {
        return "human_created"; // Treat as human to prevent hiding
    }

    // 2. Check database
    const dbClassification = await getClassificationFromDB(channelId, normalized);
    if (dbClassification) {
        return dbClassification;
    }

    // 3. Fallback to bundled JSON
    const data = await loadChannelData();

    // Check exact match first
    if (data[normalized]) {
        return data[normalized];
    }

    // Check lowercase keys (data might have mixed case)
    for (const [key, value] of Object.entries(data)) {
        if (key.toLowerCase() === normalized) {
            return value;
        }
    }

    return null;
}

/**
 * Check if a channel should be hidden based on classification and user preferences
 */
export async function shouldHideChannel(
    handle: string,
    hideAI = true,
    hideAIAssisted = false,
    hideMixed = false,
    channelId?: string
): Promise<boolean> {
    const classification = await getChannelClassification(handle, channelId);

    if (!classification) {
        return false; // Don't hide unknown channels
    }

    switch (classification) {
        case "ai_generated":
            return hideAI;
        case "ai_assisted":
            return hideAIAssisted;
        case "mixed":
            return hideMixed;
        default:
            return false;
    }
}

/**
 * Batch check multiple channels
 */
export async function getChannelClassifications(handles: string[]): Promise<Map<string, AIClassification | null>> {
    const results = new Map<string, AIClassification | null>();

    for (const handle of handles) {
        const classification = await getChannelClassification(handle);
        results.set(handle, classification);
    }

    return results;
}

/**
 * Invalidate database cache (call when labels are updated)
 */
export function invalidateDBCache(channelId?: string): void {
    if (channelId) {
        dbCache.delete(channelId);
    } else {
        dbCache.clear();
    }
}

// Export for testing
export { normalizeHandle, loadChannelData, getClassificationFromDB };


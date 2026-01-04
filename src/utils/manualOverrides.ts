/**
 * Manual channel overrides for Serenity
 * Allows users to manually block/allow specific channels regardless of classification
 */

// Override action type
export type OverrideAction = 'block' | 'allow';

// Manual override record
export interface ManualOverride {
    channelId: string;      // YouTube channel ID (UC...) or handle
    handle?: string;        // Channel handle (@username)
    action: OverrideAction; // 'block' = always hide, 'allow' = never hide
    timestamp: number;      // When the override was set
}

// Storage key for manual overrides
const STORAGE_KEY = 'serenity_manual_overrides';

// In-memory cache
let overridesCache: Map<string, ManualOverride> | null = null;

/**
 * Normalize a channel identifier for consistent lookup
 */
function normalizeId(channelId: string): string {
    let normalized = channelId.trim().toLowerCase();

    // Remove leading @ or /@
    if (normalized.startsWith('/@')) {
        normalized = normalized.slice(2);
    } else if (normalized.startsWith('@')) {
        normalized = normalized.slice(1);
    }

    return normalized;
}

/**
 * Load overrides from chrome.storage.local
 */
async function loadOverrides(): Promise<Map<string, ManualOverride>> {
    if (overridesCache !== null) {
        return overridesCache;
    }

    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const data = result[STORAGE_KEY] || {};
        overridesCache = new Map(Object.entries(data));
        console.log(`[Serenity] Loaded ${overridesCache.size} manual overrides`);
        return overridesCache;
    } catch (error) {
        console.error('[Serenity] Failed to load manual overrides:', error);
        overridesCache = new Map();
        return overridesCache;
    }
}

/**
 * Save overrides to chrome.storage.local
 */
async function saveOverrides(): Promise<void> {
    if (!overridesCache) return;

    try {
        const data = Object.fromEntries(overridesCache);
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (error) {
        console.error('[Serenity] Failed to save manual overrides:', error);
    }
}

/**
 * Set a manual override for a channel
 * @param channelId - Channel ID or handle
 * @param action - 'block' to always hide, 'allow' to never hide
 * @param handle - Optional channel handle for display
 */
export async function setOverride(
    channelId: string,
    action: OverrideAction,
    handle?: string
): Promise<void> {
    const overrides = await loadOverrides();
    const normalizedId = normalizeId(channelId);

    const override: ManualOverride = {
        channelId: normalizedId,
        handle: handle || undefined,
        action,
        timestamp: Date.now(),
    };

    overrides.set(normalizedId, override);
    await saveOverrides();

    console.log(`[Serenity] Set override for ${normalizedId}: ${action}`);
}

/**
 * Get the override for a channel
 * @param channelId - Channel ID or handle
 * @returns The override action or null if none
 */
export async function getOverride(channelId: string): Promise<OverrideAction | null> {
    const overrides = await loadOverrides();
    const normalizedId = normalizeId(channelId);

    const override = overrides.get(normalizedId);
    return override?.action || null;
}

/**
 * Get the full override record for a channel
 */
export async function getOverrideRecord(channelId: string): Promise<ManualOverride | null> {
    const overrides = await loadOverrides();
    const normalizedId = normalizeId(channelId);
    return overrides.get(normalizedId) || null;
}

/**
 * Remove a manual override for a channel
 */
export async function removeOverride(channelId: string): Promise<void> {
    const overrides = await loadOverrides();
    const normalizedId = normalizeId(channelId);

    if (overrides.delete(normalizedId)) {
        await saveOverrides();
        console.log(`[Serenity] Removed override for ${normalizedId}`);
    }
}

/**
 * List all manual overrides
 */
export async function listOverrides(): Promise<ManualOverride[]> {
    const overrides = await loadOverrides();
    return Array.from(overrides.values());
}

/**
 * List only blocked channels
 */
export async function listBlockedOverrides(): Promise<ManualOverride[]> {
    const all = await listOverrides();
    return all.filter(o => o.action === 'block');
}

/**
 * List only allowed (whitelisted) channels
 */
export async function listAllowedOverrides(): Promise<ManualOverride[]> {
    const all = await listOverrides();
    return all.filter(o => o.action === 'allow');
}

/**
 * Clear all manual overrides
 */
export async function clearAllOverrides(): Promise<void> {
    overridesCache = new Map();
    await saveOverrides();
    console.log('[Serenity] Cleared all manual overrides');
}

/**
 * Invalidate the cache (for when storage is updated externally)
 */
export function invalidateCache(): void {
    overridesCache = null;
}

// Listen for storage changes to keep cache in sync
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE_KEY]) {
            invalidateCache();
        }
    });
}

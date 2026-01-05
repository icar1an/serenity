/**
 * Centralized utility for YouTube ID normalization and URL construction.
 * This helps avoid structural errors like /@/@handle or /channel/UC... prefixes in handles.
 */

/**
 * Normalizes a YouTube channel ID or handle.
 * Strips leading @ symbols, /@ prefixes, and various path segments (channel/, user/, c/).
 * Handles redundant prefixes aggressively.
 */
export function normalizeYoutubeId(id: string | null | undefined): string {
    if (!id) return '';
    // Aggressively strip multiple leading slashes, @ symbols, and various YouTube path prefixes
    // This handles: /@handle, @@handle, /@/@handle, /channel/UC..., //channel//UC..., etc.
    // The 'i' flag makes it case-insensitive, 'g' flag ensures we get all redundant start tokens.
    // regex explanation:
    // ^      : start of string
    // (      : start group
    // \/?    : optional leading slash
    // (?:channel|user|c)\/ : non-capturing group for common path segments followed by slash
    // |      : or
    // [\s/@]+ : any combination of whitespace, slashes, or @ symbols
    // )+     : repeated one or more times
    return id.trim().replace(/^(\/?(?:channel|user|c)\/|[\s/@]+)+/i, '').replace(/\/+$/, '');
}

/**
 * Builds a consistent YouTube channel URL from a normalized identifier.
 */
export function buildYoutubeChannelUrl(identifier: string | null | undefined): string {
    const cleanId = normalizeYoutubeId(identifier);
    if (!cleanId) return '#';

    // If it looks like a UC channel ID (24 chars, starts with UC), use /channel/ format
    if (/^UC[\w-]{22}$/.test(cleanId)) {
        return `https://www.youtube.com/channel/${cleanId}`;
    }

    // Default to handle format which uses @ syntax in modern YouTube
    return `https://www.youtube.com/@${cleanId}`;
}

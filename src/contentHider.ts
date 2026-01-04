/**
 * Content hiding logic for Serenity
 * Hides videos/thumbnails from AI-classified channels on YouTube
 */

import { shouldHideChannel } from "./utils/channelLabels";
import Config from "./config";

// CSS class for hidden elements
const HIDDEN_CLASS = "serenity-hidden";
const PROCESSED_ATTR = "data-serenity-processed";

// Selectors for video elements on different YouTube page types
const VIDEO_SELECTORS = {
    // Homepage and search results
    richItem: "ytd-rich-item-renderer",
    // Video grid items
    gridVideo: "ytd-grid-video-renderer",
    // Sidebar recommendations
    compactVideo: "ytd-compact-video-renderer",
    // Search page results
    videoRenderer: "ytd-video-renderer",
    // Playlist items
    playlistItem: "ytd-playlist-video-renderer",
    // Shorts
    shortsItem: "ytd-reel-item-renderer",
    // Channel mentions
    channelRenderer: "ytd-channel-renderer"
};

/**
 * Add CSS styles for hiding elements
 */
function injectStyles(): void {
    const styleId = "serenity-hide-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        .${HIDDEN_CLASS} {
            display: none !important;
        }
        
        .serenity-hidden-placeholder {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Extract channel info from a video element
 * @returns Object with handle and channelId, or null if not found
 */
function extractChannelInfo(element: Element): { handle: string | null; channelId: string | null } {
    let handle: string | null = null;
    let channelId: string | null = null;

    // Try various selectors for channel handle
    const handleSelectors = [
        "a.yt-simple-endpoint[href*='/@']",
        "#channel-name a[href*='/@']",
        "ytd-channel-name a[href*='/@']",
        ".ytd-channel-name a[href*='/@']",
        "#text-container a[href*='/@']",
        "#owner-text a[href*='/@']",
        "a[href*='/@']"
    ];

    for (const selector of handleSelectors) {
        const link = element.querySelector(selector) as HTMLAnchorElement;
        if (link?.href) {
            const match = link.href.match(/\/@([^/?]+)/);
            if (match) {
                handle = match[1];
                break;
            }
        }
    }

    // Try getting channel ID from /channel/ links
    const channelIdSelectors = [
        "a[href*='/channel/UC']",
        "#channel-name a[href*='/channel/']",
        "ytd-channel-name a[href*='/channel/']"
    ];

    for (const selector of channelIdSelectors) {
        const link = element.querySelector(selector) as HTMLAnchorElement;
        if (link?.href) {
            const match = link.href.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
            if (match) {
                channelId = match[1];
                break;
            }
        }
    }

    return { handle, channelId };
}

/**
 * Extract channel handle from a video element (legacy wrapper)
 */
function extractChannelHandle(element: Element): string | null {
    return extractChannelInfo(element).handle;
}

/**
 * Process a single video element and hide if from AI channel
 */
async function processVideoElement(element: Element): Promise<void> {
    // Skip if already processed
    if (element.hasAttribute(PROCESSED_ATTR)) return;
    element.setAttribute(PROCESSED_ATTR, "true");

    const { handle, channelId } = extractChannelInfo(element);
    if (!handle && !channelId) return;

    const shouldHide = await shouldHideChannel(
        handle || "",
        Config.config.hideAIChannels,
        false, // hideAIAssisted - not used in current config
        Config.config.hideMixedChannels,
        channelId || undefined
    );

    if (shouldHide) {
        element.classList.add(HIDDEN_CLASS);
        console.log(`[Serenity] Hidden video from AI channel: @${handle || channelId}`);
    }
}

/**
 * Process all video elements on the page
 */
async function processAllVideoElements(): Promise<void> {
    const selectors = Object.values(VIDEO_SELECTORS).join(", ");
    const elements = document.querySelectorAll(selectors);

    const promises: Promise<void>[] = [];
    for (const element of elements) {
        promises.push(processVideoElement(element));
    }

    await Promise.all(promises);
}

/**
 * Initialize mutation observer to catch dynamically loaded content
 */
function initObserver(): void {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    // Check if this node or its children match our selectors
                    const selectors = Object.values(VIDEO_SELECTORS).join(", ");
                    if (node.matches(selectors)) {
                        processVideoElement(node);
                    }
                    const children = node.querySelectorAll(selectors);
                    for (const child of children) {
                        processVideoElement(child);
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/**
 * Initialize content hiding
 */
export async function initContentHiding(): Promise<void> {
    console.log("[Serenity] Initializing content hiding...");

    // Inject CSS styles
    injectStyles();

    // Process existing elements
    await processAllVideoElements();

    // Watch for new elements
    initObserver();

    console.log("[Serenity] Content hiding initialized");
}

/**
 * Re-process all elements (useful after settings change)
 */
export async function refreshContentHiding(): Promise<void> {
    // Remove processed attribute from all elements to re-check
    const elements = document.querySelectorAll(`[${PROCESSED_ATTR}]`);
    for (const element of elements) {
        element.removeAttribute(PROCESSED_ATTR);
        element.classList.remove(HIDDEN_CLASS);
    }

    // Re-process
    await processAllVideoElements();
}

/**
 * Show/hide elements for a specific channel (for manual override)
 */
export function toggleChannelVisibility(handle: string, visible: boolean): void {
    const normalizedHandle = handle.replace(/^@/, "");
    const elements = document.querySelectorAll(`[${PROCESSED_ATTR}]`);

    for (const element of elements) {
        const elementHandle = extractChannelHandle(element);
        if (elementHandle?.toLowerCase() === normalizedHandle.toLowerCase()) {
            if (visible) {
                element.classList.remove(HIDDEN_CLASS);
            } else {
                element.classList.add(HIDDEN_CLASS);
            }
        }
    }
}

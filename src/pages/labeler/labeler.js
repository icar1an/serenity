/**
 * Serenity Channel Labeler
 * Queue-based labeler for channel classification (ported from Clarity)
 */

/* global chrome */

// ============================================================================
// STATE
// ============================================================================
let selectedIsAi = null;
let isSaving = false;
let currentQueueItem = null;
let currentQueueItemId = null;
let isLoadingCandidate = false;
let pollBackoffDelay = 10000;
let lastLabeledChannel = null;
let labelerId = null;
let currentCounterValue = 0;

// ============================================================================
// DOM ELEMENTS
// ============================================================================
const statusBanner = document.getElementById('status-banner');
const statusMessage = document.getElementById('status-message');
const thumbnail = document.getElementById('thumbnail');
const videoLink = document.getElementById('video-link');
const videoTitle = document.getElementById('video-title');
const channelTitle = document.getElementById('channel-title');
const channelHandle = document.getElementById('channel-handle');
const channelIdEl = document.getElementById('channel-id');
const description = document.getElementById('description');
const btnAi = document.getElementById('btn-ai');
const btnNotAi = document.getElementById('btn-not-ai');
const btnGoBack = document.getElementById('btn-go-back');
const flipClockWrapper = document.getElementById('flip-clock-wrapper');
const channelSignals = document.getElementById('channel-signals');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get or create a UUID-based anonymous labeler ID
 */
function getOrCreateLabelerId() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['serenity_labeler_id'], (result) => {
            if (result.serenity_labeler_id) {
                resolve(result.serenity_labeler_id);
            } else {
                const newId = crypto.randomUUID();
                chrome.storage.local.set({ serenity_labeler_id: newId }, () => {
                    resolve(newId);
                });
            }
        });
    });
}

/**
 * Get config from chrome storage
 */
async function getConfig() {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            'supabase_url',
            'supabase_anon_key',
            'manual_labeler_token'
        ], (result) => {
            const baseUrl = result.supabase_url || '';
            resolve({
                labelerNextUrl: baseUrl ? `${baseUrl}/functions/v1/labeler-next` : '',
                labelerMarkUrl: baseUrl ? `${baseUrl}/functions/v1/vote-channel` : '',
                token: result.manual_labeler_token || '',
                anonKey: result.supabase_anon_key || '',
            });
        });
    });
}

/**
 * Show status banner
 */
function showStatus(type, message, autoHide = true) {
    if (!statusBanner || !statusMessage) return;

    statusBanner.className = `status-banner ${type}`;
    statusMessage.textContent = message;
    statusBanner.classList.remove('hidden');

    if (autoHide) {
        const delay = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            statusBanner.classList.add('hidden');
        }, delay);
    }
}

/**
 * Hide status banner
 */
function hideStatus() {
    if (statusBanner) statusBanner.classList.add('hidden');
}

/**
 * Truncate text
 */
function truncateText(text, maxLength = 400) {
    if (!text || text.length <= maxLength) return text || '(unknown)';
    return text.substring(0, maxLength) + '...';
}

/**
 * Build YouTube video URL
 */
function buildVideoUrl(videoId) {
    if (!videoId) return '#';
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build YouTube channel URL
 */
/**
 * Normalize channel ID or handle
 */
function normalize(id) {
    if (!id) return id;
    // Aggressively strip multiple leading slashes, @ symbols, and various YouTube path prefixes
    // This handles: /@handle, @@handle, /@/@handle, /channel/UC..., //channel//UC..., etc.
    return id.trim().replace(/^(\/?(?:channel|user|c)\/|[\s/@]+)+/i, '').replace(/\/+$/, '');
}

/**
 * Clean string values
 */
function cleanValue(val) {
    if (!val) return null;
    if (typeof val === 'string') {
        const cleaned = val.trim();
        if (cleaned.toLowerCase() === '(unknown)' || cleaned === 'null' || cleaned === 'undefined') {
            return null;
        }
        return cleaned;
    }
    return val;
}

/**
 * Build YouTube channel URL
 */
function buildChannelUrl(channelId, handle) {
    const identifier = normalize(handle || channelId);
    if (!identifier) return '#';

    // If it looks like a UC channel ID (24 chars, starts with UC), use /channel/ format
    if (/^UC[\w-]{22}$/.test(identifier)) {
        return `https://www.youtube.com/channel/${identifier}`;
    }

    // Default to handle/custom URL format which uses @ syntax in modern YouTube
    return `https://www.youtube.com/@${identifier}`;
}

/**
 * Fetch thumbnail from channel page
 */
async function getThumbnailFromChannelPage(handleOrId) {
    if (!handleOrId) return null;

    try {
        const url = buildChannelUrl(null, handleOrId);
        if (url === '#') return null;

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                message: "sendRequest",
                type: "GET",
                url: url
            }, (response) => {
                if (!response || !response.ok || !response.responseText) {
                    resolve(null);
                    return;
                }

                const html = response.responseText;
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    // Try multiple meta tags
                    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
                    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
                    const linkImage = doc.querySelector('link[rel="image_src"]')?.getAttribute('href');

                    const foundImage = ogImage || twitterImage || linkImage;

                    if (foundImage) {
                        console.log('[Serenity Labeler] Found thumbnail:', foundImage);
                        resolve(foundImage);
                    } else {
                        console.warn('[Serenity Labeler] No thumbnail found in page metadata');
                        resolve(null);
                    }
                } catch (parseError) {
                    console.error('[Serenity Labeler] Failed to parse HTML:', parseError);
                    resolve(null);
                }
            });
        });
    } catch (e) {
        console.error('[Serenity Labeler] Failed to fetch thumbnail fallback:', e);
        return null;
    }
}


/**
 * Load queue item data into UI
 */
function loadCandidateData(queueItem) {
    if (!queueItem) {
        // Show empty state
        if (videoLink) videoLink.href = '#';
        if (thumbnail) {
            thumbnail.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect fill="%23ddd" width="640" height="360"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo thumbnail%3C/text%3E%3C/svg%3E';
            thumbnail.alt = 'No thumbnail available';
        }
        if (videoTitle) videoTitle.textContent = '(unknown)';
        if (channelTitle) channelTitle.textContent = '(unknown)';
        if (channelHandle) channelHandle.textContent = '(unknown)';
        if (channelIdEl) channelIdEl.textContent = '(unknown)';
        if (description) description.textContent = '(unknown)';
        return;
    }

    // Extract data from queue item
    const videoId = cleanValue(queueItem.sample_video_id);
    const thumbnailUrl = cleanValue(queueItem.sample_thumbnail);
    const title = cleanValue(queueItem.sample_title);
    const desc = cleanValue(queueItem.sample_description);
    const chId = normalize(queueItem.youtube_channel_id);
    const chTitle = cleanValue(queueItem.channel_title);
    const handle = queueItem.handle ? normalize(queueItem.handle) : null;

    const displayHandle = handle ? `@${handle}` : chId;
    const candidateTitle = title || chTitle || displayHandle || '(unknown)';

    // Set video link
    if (videoLink) {
        if (videoId) {
            videoLink.href = buildVideoUrl(videoId);
        } else if (chId) {
            videoLink.href = buildChannelUrl(chId, handle);
        } else {
            videoLink.href = '#';
        }
    }

    // Set thumbnail
    if (thumbnail) {
        let finalThumbnailUrl = thumbnailUrl;
        if (!finalThumbnailUrl && videoId) {
            finalThumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }

        if (finalThumbnailUrl) {
            thumbnail.src = finalThumbnailUrl;
            thumbnail.alt = candidateTitle;
        } else {
            thumbnail.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect fill="%23ddd" width="640" height="360"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo thumbnail%3C/text%3E%3C/svg%3E';
            thumbnail.alt = 'No thumbnail available';

            // Fallback: Try to fetch thumbnail from channel page
            if (displayHandle || chId) {
                getThumbnailFromChannelPage(displayHandle || chId).then(url => {
                    if (url && thumbnail) {
                        thumbnail.src = url;
                        // Determine if we should update other metadata
                        // We could also emit an event or update the local item, handling that later if needed
                    }
                });
            }
        }
    }

    // Set video title
    if (videoTitle) {
        videoTitle.textContent = candidateTitle;
    }

    // Set channel info
    if (channelTitle) channelTitle.textContent = chTitle || displayHandle || '(unknown)';

    if (channelHandle) {
        channelHandle.textContent = displayHandle || '(unknown)';
    }

    // Set channel ID link
    if (channelIdEl) {
        if (chId) {
            channelIdEl.textContent = chId;
            channelIdEl.href = buildChannelUrl(chId, handle);
        } else {
            channelIdEl.textContent = '(unknown)';
            channelIdEl.href = '#';
        }
    }

    // Set description
    if (description) description.textContent = truncateText(desc);

    // Hide channel signals (not available in queue format)
    if (channelSignals) channelSignals.classList.add('hidden');
}

/**
 * Fetch next candidate from Supabase queue
 */
async function fetchNextCandidate(isPolling = false) {
    if (isLoadingCandidate && !isPolling) {
        return;
    }

    const config = await getConfig();
    if (!config.labelerNextUrl || !config.token) {
        showStatus('error', 'Supabase configuration missing. Check extension settings.');
        return;
    }

    // Get or create labeler ID
    if (!labelerId) {
        labelerId = await getOrCreateLabelerId();
        console.log('[Serenity Labeler] Using labeler ID:', labelerId);
    }

    isLoadingCandidate = true;

    // 1. Check for manual candidate in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const manualChannelId = urlParams.get('channelId');
    if (manualChannelId && !isPolling) {
        console.log('[Serenity Labeler] Found manual candidate in URL:', manualChannelId);

        // Construct a pseudo queue item from URL params
        const manualItem = {
            id: null, // We don't have the UUID yet, vote-channel can handle upsert by youtube_channel_id if we modify it, 
            // or we fetch/create it here. For now, let's assume we need to use youtube_channel_id.
            youtube_channel_id: normalize(manualChannelId), // Normalize to ensure clean ID is stored/displayed
            handle: urlParams.get('handle'),
            channel_title: urlParams.get('channelTitle'),
            sample_video_id: urlParams.get('videoId'),
            sample_thumbnail: urlParams.get('thumbnail') || (urlParams.get('videoId') ? `https://i.ytimg.com/vi/${urlParams.get('videoId')}/hqdefault.jpg` : null),
            sample_title: urlParams.get('title'),
            sample_description: urlParams.get('description')
        };

        currentQueueItem = manualItem;
        currentQueueItemId = manualChannelId; // Using youtube_channel_id as temp ID
        loadCandidateData(manualItem);

        if (btnAi) btnAi.disabled = false;
        if (btnNotAi) btnNotAi.disabled = false;
        isLoadingCandidate = false;
        hideStatus();

        // Clean up URL to avoid re-loading on refresh
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    if (!isPolling) {
        showStatus('loading', 'Loading next channel…', false);
    }

    if (btnAi) btnAi.disabled = true;
    if (btnNotAi) btnNotAi.disabled = true;

    try {
        const headers = {
            'X-Manual-Labeler-Token': config.token,
        };

        if (config.anonKey) {
            headers['apikey'] = config.anonKey;
            headers['Authorization'] = `Bearer ${config.anonKey}`;
        }

        const url = new URL(config.labelerNextUrl);
        url.searchParams.set('labeler_id', labelerId);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: headers,
        });

        let data;
        try {
            const text = await response.text();
            data = JSON.parse(text);
        } catch (e) {
            data = { ok: false, error: `Invalid JSON response` };
        }

        if (!response.ok) {
            const errorMsg = data.error || `HTTP ${response.status}`;
            console.error('[Serenity Labeler] API Error:', errorMsg);
            showStatus('error', `Error: ${errorMsg}`);
            if (btnAi) btnAi.disabled = false;
            if (btnNotAi) btnNotAi.disabled = false;
            isLoadingCandidate = false;
            return;
        }

        // Handle empty queue with backoff polling
        if (!data.ok && data.error === 'empty_queue') {
            pollBackoffDelay = Math.min(pollBackoffDelay * 2, 60000);
            console.log(`[Serenity Labeler] Queue empty, polling in ${pollBackoffDelay / 1000}s`);
            showStatus('info', `Queue empty — browse YouTube to find channels (retrying in ${pollBackoffDelay / 1000}s…)`, false);
            isLoadingCandidate = false;

            setTimeout(() => {
                fetchNextCandidate(true);
            }, pollBackoffDelay);
            return;
        }

        // Reset backoff on success
        pollBackoffDelay = 10000;

        // Handle other errors
        if (!data.ok || !data.item) {
            const errorMsg = data.error || 'Unknown error';
            console.error('[Serenity Labeler] Error:', errorMsg);
            showStatus('error', `Error: ${errorMsg}`);
            if (btnAi) btnAi.disabled = false;
            if (btnNotAi) btnNotAi.disabled = false;
            isLoadingCandidate = false;
            return;
        }

        // Success: Load queue item into UI
        // Normalize ID from API just in case DB is dirty
        if (data.item.youtube_channel_id) {
            data.item.youtube_channel_id = normalize(data.item.youtube_channel_id);
        }

        console.log('[Serenity Labeler] Loaded channel:', data.item.youtube_channel_id);
        currentQueueItem = data.item;
        currentQueueItemId = data.item.id;
        loadCandidateData(data.item);

        // Reset UI state
        selectedIsAi = null;
        if (btnAi) {
            btnAi.classList.remove('selected');
            btnAi.disabled = false;
        }
        if (btnNotAi) {
            btnNotAi.classList.remove('selected');
            btnNotAi.disabled = false;
        }
        if (btnGoBack) btnGoBack.disabled = !lastLabeledChannel;

        hideStatus();
        isLoadingCandidate = false;

    } catch (error) {
        console.error('[Serenity Labeler] Unexpected error:', error);
        showStatus('error', `Error: ${error.message}`);
        if (btnAi) btnAi.disabled = false;
        if (btnNotAi) btnNotAi.disabled = false;
        isLoadingCandidate = false;
    }
}

/**
 * Submit label to Supabase
 */
async function submitLabel(isAi) {
    if (!currentQueueItem || !currentQueueItemId) {
        showStatus('error', 'No channel data available');
        return;
    }

    isSaving = true;
    showStatus('loading', 'Saving label...', false);

    if (btnAi) btnAi.disabled = true;
    if (btnNotAi) btnNotAi.disabled = true;

    try {
        const config = await getConfig();
        if (!config.labelerMarkUrl) {
            showStatus('error', 'Supabase configuration missing');
            isSaving = false;
            return;
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Manual-Labeler-Token': config.token,
        };

        if (config.anonKey) {
            headers['apikey'] = config.anonKey;
            headers['Authorization'] = `Bearer ${config.anonKey}`;
        }

        const payload = {
            channel_id: currentQueueItemId,
            user_identifier: labelerId,
            is_ai: isAi,
            metadata: {
                channel_title: currentQueueItem.channel_title,
                description: currentQueueItem.sample_description,
                sample_video_id: currentQueueItem.sample_video_id,
                sample_thumbnail: currentQueueItem.sample_thumbnail,
                sample_title: currentQueueItem.sample_title,
                sample_description: currentQueueItem.sample_description,
                handle: currentQueueItem.handle
            }
        };

        // If this was a manual entry, we might need to tell the backend to look up by youtube_channel_id
        if (!currentQueueItem.id) {
            // @ts-ignore
            payload.youtube_channel_id = currentQueueItem.youtube_channel_id;
        }

        const response = await fetch(config.labelerMarkUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        // Store for undo functionality
        lastLabeledChannel = currentQueueItem.youtube_channel_id;

        showStatus('success', `Channel labeled as ${isAi ? 'AI Generated' : 'Human Created'}`);

        // Increment counter
        incrementCounter();

        // Fetch next candidate
        setTimeout(() => {
            fetchNextCandidate();
        }, 500);

    } catch (error) {
        console.error('[Serenity Labeler] Error submitting label:', error);
        showStatus('error', `Error: ${error.message}`);
        if (btnAi) btnAi.disabled = false;
        if (btnNotAi) btnNotAi.disabled = false;
    } finally {
        isSaving = false;
    }
}

/**
 * Initialize flip clock counter
 */
function initFlipClock() {
    if (!flipClockWrapper) return;

    chrome.storage.local.get(['serenity_labels_count'], (result) => {
        currentCounterValue = result.serenity_labels_count || 0;
        updateFlipClockDisplay(currentCounterValue);
    });
}

/**
 * Update flip clock display
 */
function updateFlipClockDisplay(value) {
    if (!flipClockWrapper) return;

    const digits = String(value).padStart(5, '0').split('');
    flipClockWrapper.innerHTML = digits.map(d =>
        `<div class="flip-clock-nums" data-current="${d}">
      <div class="flip-clock-num" data-num="${d}" data-num-next="${d}"></div>
    </div>`
    ).join('');
}

/**
 * Increment counter
 */
function incrementCounter() {
    currentCounterValue++;
    updateFlipClockDisplay(currentCounterValue);
    chrome.storage.local.set({ serenity_labels_count: currentCounterValue });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

// AI button click
if (btnAi) {
    btnAi.addEventListener('click', () => {
        if (isSaving || isLoadingCandidate) return;
        btnAi.classList.add('selected');
        btnNotAi?.classList.remove('selected');
        submitLabel(true);
    });
}

// Not AI button click
if (btnNotAi) {
    btnNotAi.addEventListener('click', () => {
        if (isSaving || isLoadingCandidate) return;
        btnNotAi.classList.add('selected');
        btnAi?.classList.remove('selected');
        submitLabel(false);
    });
}

// Go Back button
if (btnGoBack) {
    btnGoBack.addEventListener('click', () => {
        // TODO: Implement undo functionality
        showStatus('info', 'Undo not yet implemented');
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (isSaving || isLoadingCandidate) return;

    const key = e.key.toLowerCase();

    if (key === 'a') {
        btnAi?.click();
    } else if (key === 'h') {
        btnNotAi?.click();
    } else if (key === 'b') {
        btnGoBack?.click();
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initFlipClock();
    fetchNextCandidate();
});

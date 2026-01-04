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
                labelerMarkUrl: baseUrl ? `${baseUrl}/functions/v1/labeler-mark` : '',
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
function buildChannelUrl(channelId, handle) {
    if (handle) {
        const h = handle.startsWith('@') ? handle : `@${handle}`;
        return `https://www.youtube.com/${h}`;
    }
    if (channelId) {
        return `https://www.youtube.com/channel/${channelId}`;
    }
    return '#';
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
    const videoId = queueItem.sample_video_id || null;
    const thumbnailUrl = queueItem.sample_thumbnail || null;
    const title = queueItem.sample_title || null;
    const desc = queueItem.sample_description || null;
    const chId = queueItem.youtube_channel_id;
    const chTitle = queueItem.channel_title || null;
    const handle = queueItem.handle || null;

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
        if (thumbnailUrl) {
            thumbnail.src = thumbnailUrl;
            thumbnail.alt = title || 'Video thumbnail';
        } else {
            thumbnail.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect fill="%23ddd" width="640" height="360"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo thumbnail%3C/text%3E%3C/svg%3E';
            thumbnail.alt = 'No thumbnail available';
        }
    }

    // Set video title
    if (videoTitle) {
        videoTitle.textContent = title || chTitle || `Channel: ${chId}` || '(unknown)';
    }

    // Set channel info
    if (channelTitle) channelTitle.textContent = chTitle || '(unknown)';

    if (channelHandle) {
        if (handle) {
            let displayHandle = handle;
            if (handle.startsWith('/@')) {
                displayHandle = handle.substring(1);
            } else if (!handle.startsWith('@')) {
                displayHandle = `@${handle}`;
            }
            channelHandle.textContent = displayHandle;
        } else {
            channelHandle.textContent = chId || '(unknown)';
        }
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
            queue_item_id: currentQueueItemId,
            youtube_channel_id: currentQueueItem.youtube_channel_id,
            is_ai: isAi,
            labeler_id: labelerId,
            status: 'labeled',
        };

        const response = await fetch(config.labelerMarkUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
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

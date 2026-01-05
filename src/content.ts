/* eslint-disable @typescript-eslint/no-empty-function */
import Config from "./config";
import Utils from "./utils";
import { setupVideoModule, getVideoID, getChannelIDInfo, checkVideoIDChange } from "../maze-utils/src/video";

import { normalizeYoutubeId } from "./utils/youtubeUtils";
import { cleanPage } from "./utils/pageCleaner";
import { initContentHiding, refreshContentHiding } from "./contentHider";
import * as documentScript from "../dist/js/document.js";
import { Message, MessageResponse } from "./messageTypes";
import { StorageChangesObject } from "../maze-utils/src/config";
import { onVideoPage } from "../maze-utils/src/pageInfo";

cleanPage();

const utils = new Utils();

utils.wait(() => Config.isReady(), 5000, 10).then(() => {

    // Serenity: Initialize AI channel content hiding
    initContentHiding().catch(console.error);
});

// Is the video currently being switching
let switchingVideos = null;

setupVideoModule({
    videoIDChange,
    channelIDChange: () => { },
    videoElementChange: () => { },
    playerInit: () => { },
    updatePlayerBar: () => { },
    resetValues,
    documentScript: chrome.runtime.getManifest().manifest_version === 2 ? documentScript : undefined
}, () => Config);

function resetValues() {
    // When first loading a video, it is not switching videos
    if (switchingVideos === null || !onVideoPage()) {
        switchingVideos = false;
    } else {
        switchingVideos = true;
    }
}

function videoIDChange(): void {
    // Notify the popup about the video change
    const channelInfo = getChannelIDInfo();
    try {
        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({
                message: "videoChanged",
                videoID: getVideoID(),
                channelID: channelInfo.id,
                channelAuthor: channelInfo.author
            }).catch(() => {
                // Ignore errors if the extension context is invalidated
            });
        }
    } catch (e) {
        // Ignore "Extension context invalidated" errors
    }
}

function contentConfigUpdateListener(changes: StorageChangesObject) {
    for (const key in changes) {
        switch (key) {
            case "hideAIChannels":
            case "hideMixedChannels":
                refreshContentHiding();
                break;
        }
    }
}

if (!window.location.href.includes("youtube.com/live_chat")) {
    if (!Config.configSyncListeners.includes(contentConfigUpdateListener)) {
        Config.configSyncListeners.push(contentConfigUpdateListener);
    }
}

// Message listener
chrome.runtime.onMessage.addListener((request: Message, sender: unknown, sendResponse: (response: MessageResponse) => void) => {
    switch (request.message) {
        case "update":
            checkVideoIDChange();
            break;
        case "getChannelID":
            sendResponse({
                channelID: getChannelIDInfo().id,
                isYTTV: (document.location.host === "tv.youtube.com")
            });
            break;
        // Serenity: Get video/channel info for labeler
        case "serenity_get_video_info": {
            const channelInfo = getChannelIDInfo();
            const currentVideoID = getVideoID();
            const thumbnailUrl = currentVideoID
                ? `https://i.ytimg.com/vi/${currentVideoID}/hqdefault.jpg`
                : null;

            const cleanChannelId = normalizeYoutubeId(channelInfo.id);
            const cleanHandle = channelInfo.author?.startsWith('@') ? normalizeYoutubeId(channelInfo.author) : undefined;

            sendResponse({
                videoId: currentVideoID,
                channelId: cleanChannelId,
                handle: cleanHandle,
                channelTitle: channelInfo.author,
                title: document.querySelector('h1.ytd-video-primary-info-renderer, h1.title')?.textContent?.trim()
                    || document.querySelector('meta[name="title"]')?.getAttribute('content'),
                description: document.querySelector('#description-inline-expander .content, #description')?.textContent?.trim()?.substring(0, 500),
                thumbnail: thumbnailUrl,
            });
            return;
        }
    }
    sendResponse({});
});

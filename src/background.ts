import Config from "./config";
import { Registration } from "./types";
import "content-scripts-register-polyfill";
import { setupBackgroundRequestProxy } from "../maze-utils/src/background-request-proxy";
import { setupTabUpdates } from "../maze-utils/src/tab-updates";
import { generateUserID } from "../maze-utils/src/setup";

import Utils from "./utils";
import { getExtensionIdsToImportFrom } from "./utils/configUtils";
import { isFirefoxOrSafari, waitFor } from "../maze-utils/src";
import { injectUpdatedScripts } from "../maze-utils/src/cleanup";
import { logWarn } from "./utils/logger";
import { chromeP } from "../maze-utils/src/browserApi";
import { getHash } from "../maze-utils/src/hash";
import { setOverride, getOverride, removeOverride, listOverrides } from "./utils/manualOverrides";
import { invalidateDBCache } from "./utils/channelLabels";
import { initializeSerenityConfig } from "./utils/serenityConfig";

const utils = new Utils({
    registerFirefoxContentScript,
    unregisterFirefoxContentScript
});

const popupPort: Record<string, chrome.runtime.Port> = {};

// Used only on Firefox, which does not support non persistent background pages.
const contentScriptRegistrations = {};

// Register content script if needed
utils.wait(() => Config.isReady()).then(function () {
    if (Config.config.supportInvidious) utils.setupExtraSiteContentScripts();
});

setupBackgroundRequestProxy();
setupTabUpdates(Config);

// Serenity: Initialize config on startup
initializeSerenityConfig().catch(e => console.error('[Serenity] Config init failed:', e));

chrome.runtime.onMessage.addListener(function (request, sender, callback) {
    switch (request.message) {
        case "openConfig":
            chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + (request.hash ? '#' + request.hash : '')) });
            return false;
        case "openHelp":
            chrome.tabs.create({ url: chrome.runtime.getURL('help/index.html') });
            return false;
        case "openPage":
            chrome.tabs.create({ url: chrome.runtime.getURL(request.url) });
            return false;

        case "registerContentScript":
            registerFirefoxContentScript(request);
            return false;
        case "unregisterContentScript":
            unregisterFirefoxContentScript(request.id)
            return false;
        case "tabs": {
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, tabs => {
                chrome.tabs.sendMessage(
                    tabs[0].id,
                    request.data,
                    (response) => {
                        callback(response);
                    }
                );
            });
            return true;
        }
        case "time":
        case "infoUpdated":
        case "videoChanged":
            if (sender.tab) {
                try {
                    popupPort[sender.tab.id]?.postMessage(request);
                } catch (e) {
                    // This can happen if the popup is closed
                }
            }
            return false;
        // Serenity: Manual override handlers
        case "serenity_set_override":
            setOverride(request.channelId, request.action, request.handle)
                .then(() => {
                    invalidateDBCache(request.channelId);
                    callback({ success: true });
                })
                .catch(e => callback({ success: false, error: e.message }));
            return true;
        case "serenity_get_override":
            getOverride(request.channelId)
                .then(action => callback({ action }))
                .catch(e => callback({ action: null, error: e.message }));
            return true;
        case "serenity_remove_override":
            removeOverride(request.channelId)
                .then(() => {
                    invalidateDBCache(request.channelId);
                    callback({ success: true });
                })
                .catch(e => callback({ success: false, error: e.message }));
            return true;
        case "serenity_list_overrides":
            listOverrides()
                .then(overrides => callback({ overrides }))
                .catch(e => callback({ overrides: [], error: e.message }));
            return true;
        default:
            return false;
    }
});

chrome.runtime.onMessageExternal.addListener((request, sender, callback) => {
    if (getExtensionIdsToImportFrom().includes(sender.id)) {
        if (request.message === "requestConfig") {
            callback({
                userID: Config.config.userID,

                showDonationLink: Config.config.showDonationLink,
                darkMode: Config.config.darkMode,
            })
        }
    }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, tabs => {
            popupPort[tabs[0].id] = port;
        });
    }
});

//add help page on install
chrome.runtime.onInstalled.addListener(function () {
    // This let's the config sync to run fully before checking.
    // This is required on Firefox
    setTimeout(async () => {
        const userID = Config.config.userID;

        // If there is no userID, then it is the first install.
        if (!userID && !Config.local.alreadyInstalled) {
            //open up the install page
            chrome.tabs.create({ url: chrome.runtime.getURL("/help/index.html") });

            //generate a userID
            const newUserID = generateUserID();
            //save this UUID
            Config.config.userID = newUserID;
            Config.local.alreadyInstalled = true;

        }

        if (Config.config.supportInvidious) {
            if (!(await utils.containsInvidiousPermission())) {
                chrome.tabs.create({ url: chrome.runtime.getURL("/permissions/index.html") });
            }
        }

        getHash(Config.config!.userID!).then((userID) => {
            if (userID == "60eed03c8644b7efa32df06977b3a4c11b62f63518e74a0e29baa1fd449cb54f") {
                Config.config.prideTheme = true;
            }
        });
    }, 1500);

    if (!isFirefoxOrSafari()) {
        injectUpdatedScripts().catch(logWarn);

        waitFor(() => Config.isReady()).then(() => {
            if (Config.config.supportInvidious) {
                injectUpdatedScripts([
                    utils.getExtraSiteRegistration()
                ])
            }
        }).catch(logWarn);
    }

    // Serenity: Create context menu for channel labeling
    chrome.contextMenus.create({
        id: 'serenity-label-channel',
        title: 'Label this channel (Serenity)',
        contexts: ['page'],
        documentUrlPatterns: ['https://www.youtube.com/*', 'https://youtube.com/*']
    });
});

// Serenity: Handle context menu clicks for channel labeling
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'serenity-label-channel' && tab?.id) {
        // Get video/channel info from the current page
        chrome.tabs.sendMessage(tab.id, { message: 'serenity_get_video_info' }, (response) => {
            const params = new URLSearchParams();

            if (response?.videoId) params.set('videoId', response.videoId);
            if (response?.channelId) params.set('channelId', response.channelId);
            if (response?.handle) params.set('handle', response.handle);
            if (response?.title) params.set('title', response.title);
            if (response?.channelTitle) params.set('channelTitle', response.channelTitle);
            if (response?.description) params.set('description', response.description);
            if (response?.thumbnail) params.set('thumbnail', response.thumbnail);

            const labelerUrl = chrome.runtime.getURL(`pages/labeler/labeler.html?${params.toString()}`);
            chrome.tabs.create({ url: labelerUrl });
        });
    }
});

/**
 * Only works on Firefox.
 * Firefox requires that it be applied after every extension restart.
 *
 * @param {JSON} options
 */
async function registerFirefoxContentScript(options: Registration) {
    if ("scripting" in chrome && "getRegisteredContentScripts" in chrome.scripting) {
        const existingRegistrations = await chromeP.scripting.getRegisteredContentScripts({
            ids: [options.id]
        }).catch(() => []);

        if (existingRegistrations && existingRegistrations.length > 0
            && options.matches.every((match) => existingRegistrations[0].matches.includes(match))) {
            // No need to register another script, already registered
            return;
        }
    }

    await unregisterFirefoxContentScript(options.id);

    if ("scripting" in chrome && "getRegisteredContentScripts" in chrome.scripting) {
        await chromeP.scripting.registerContentScripts([{
            id: options.id,
            runAt: "document_start",
            matches: options.matches,
            allFrames: options.allFrames,
            js: options.js,
            css: options.css,
            persistAcrossSessions: true,
        }]);
    } else {
        chrome.contentScripts.register({
            allFrames: options.allFrames,
            js: options.js?.map?.(file => ({ file })),
            css: options.css?.map?.(file => ({ file })),
            matches: options.matches
        }).then((registration) => void (contentScriptRegistrations[options.id] = registration));
    }

}

/**
 * Only works on Firefox.
 * Firefox requires that this is handled by the background script
 */
async function unregisterFirefoxContentScript(id: string) {
    if ("scripting" in chrome && "getRegisteredContentScripts" in chrome.scripting) {
        try {
            await chromeP.scripting.unregisterContentScripts({
                ids: [id]
            });
        } catch (e) {
            // Not registered yet
        }
    } else {
        if (contentScriptRegistrations[id]) {
            contentScriptRegistrations[id].unregister();
            delete contentScriptRegistrations[id];
        }
    }
}







import Config from "./config";
import { BackgroundScriptContainer, Registration } from "./types";
import { waitFor } from "../maze-utils/src";
import { isSafari } from "../maze-utils/src/config";

export default class Utils {

    // Contains functions needed from the background script
    backgroundScriptContainer: BackgroundScriptContainer | null;

    // Used to add content scripts and CSS required
    js = [
        "./js/content.js"
    ];
    css = [
        "content.css",
        "./libs/Source+Sans+Pro.css",
        "popup.css",
        "shared.css"
    ];

    constructor(backgroundScriptContainer: BackgroundScriptContainer = null) {
        this.backgroundScriptContainer = backgroundScriptContainer;
    }

    async wait<T>(condition: () => T, timeout = 5000, check = 100): Promise<T> {
        return waitFor(condition, timeout, check);
    }

    containsPermission(permissions: chrome.permissions.Permissions): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.permissions.contains(permissions, resolve)
        });
    }

    /**
     * Asks for the optional permissions required for all extra sites.
     * It also starts the content script registrations.
     * 
     * For now, it is just SB.config.invidiousInstances.
     * 
     * @param {CallableFunction} callback
     */
    setupExtraSitePermissions(callback: (granted: boolean) => void): void {
        const permissions = [];
        if (isSafari()) {
            permissions.push("webNavigation");
        }

        chrome.permissions.request({
            origins: this.getPermissionRegex(),
            permissions: permissions
        }, async (granted) => {
            if (granted) {
                this.setupExtraSiteContentScripts();
            } else {
                this.removeExtraSiteRegistration();
            }

            callback(granted);
        });
    }

    getExtraSiteRegistration(): Registration {
        return {
            message: "registerContentScript",
            id: "invidious",
            allFrames: true,
            js: this.js,
            css: this.css,
            matches: this.getPermissionRegex()
        };
    }

    /**
     * Registers the content scripts for the extra sites.
     * Will use a different method depending on the browser.
     * This is called by setupExtraSitePermissions().
     * 
     * For now, it is just SB.config.invidiousInstances.
     */
    setupExtraSiteContentScripts(): void {
        const registration = this.getExtraSiteRegistration();

        if (this.backgroundScriptContainer) {
            this.backgroundScriptContainer.registerFirefoxContentScript(registration);
        } else {
            chrome.runtime.sendMessage(registration);
        }
    }

    /**
     * Removes the permission and content script registration.
     */
    removeExtraSiteRegistration(): void {
        const id = "invidious";

        if (this.backgroundScriptContainer) {
            this.backgroundScriptContainer.unregisterFirefoxContentScript(id);
        } else {
            chrome.runtime.sendMessage({
                message: "unregisterContentScript",
                id: id
            });
        }

        chrome.permissions.remove({
            origins: this.getPermissionRegex()
        });
    }

    applyInvidiousPermissions(enable: boolean, option = "supportInvidious"): Promise<boolean> {
        return new Promise((resolve) => {
            if (enable) {
                this.setupExtraSitePermissions((granted) => {
                    if (!granted) {
                        Config.config[option] = false;
                    }

                    resolve(granted);
                });
            } else {
                this.removeExtraSiteRegistration();
                resolve(false);
            }
        });
    }

    containsInvidiousPermission(): Promise<boolean> {
        return new Promise((resolve) => {
            const permissions = [];
            if (isSafari()) {
                permissions.push("webNavigation");
            }

            chrome.permissions.contains({
                origins: this.getPermissionRegex(),
                permissions: permissions
            }, function (result) {
                resolve(result);
            });
        })
    }

    /**
     * @returns {String[]} Domains in regex form
     */
    getPermissionRegex(domains: string[] = []): string[] {
        const permissionRegex: string[] = [];
        if (domains.length === 0) {
            domains = [...Config.config.invidiousInstances];
        }

        for (const url of domains) {
            permissionRegex.push("https://*." + url + "/*");
            permissionRegex.push("http://*." + url + "/*");
        }

        return permissionRegex;
    }

    isContentScript(): boolean {
        return window.location.protocol === "http:" || window.location.protocol === "https:";
    }

    isHex(num: string): boolean {
        return Boolean(num.match(/^[0-9a-f]+$/i));
    }
}

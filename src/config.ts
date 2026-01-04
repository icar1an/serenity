
import * as invidiousList from "../ci/invidiouslist.json";
import { ProtoConfig } from "../maze-utils/src/config";

interface SBConfig {
    userID: string;
    serverAddress: string;
    invidiousInstances: string[];
    supportInvidious: boolean;
    showDonationLink: boolean;
    donateClicked: number;
    darkMode: boolean;
    prideTheme: boolean;

    // Serenity AI Channel Hiding
    hideAIChannels: boolean;
    hideMixedChannels: boolean;

    // Dev
    testingServer: boolean;
}

interface SBStorage {
    // Used when sync storage disabled
    alreadyInstalled: boolean;
    navigationApiAvailable: boolean;
}

class ConfigClass extends ProtoConfig<SBConfig, SBStorage> {
    resetToDefault() {
        chrome.storage.sync.set({
            ...this.syncDefaults,
            userID: this.config.userID
        });

        chrome.storage.local.set({
            ...this.localDefaults,
        });
    }
}

function migrateOldSyncFormats(config: SBConfig) {
    // Migration logic if needed, or stripped for now
    // populate invidiousInstances with new instances if 3p support is **DISABLED**
    if (!config["supportInvidious"] && config["invidiousInstances"] && config["invidiousInstances"].length < invidiousList.length) {
        config["invidiousInstances"] = [...new Set([...invidiousList, ...config["invidiousInstances"]])];
    }
}

const syncDefaults = {
    userID: null,
    serverAddress: "",
    invidiousInstances: [],
    supportInvidious: false,
    showDonationLink: true,
    donateClicked: 0,
    darkMode: true,
    prideTheme: false,

    // Serenity AI Channel Hiding defaults
    hideAIChannels: true,
    hideMixedChannels: false,

    testingServer: false
};

const localDefaults = {
    alreadyInstalled: false,
    navigationApiAvailable: false
};

const Config = new ConfigClass(syncDefaults, localDefaults, migrateOldSyncFormats);
export default Config;

export function generateDebugDetails(): string {
    // Build output debug information object
    const output = {
        debug: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            extensionVersion: chrome.runtime.getManifest().version
        },
        config: JSON.parse(JSON.stringify(Config.cachedSyncConfig)) // Deep clone config object
    };

    // Sanitise sensitive user config values
    delete output.config.userID;
    output.config.serverAddress = "Default server address";

    return JSON.stringify(output, null, 4);
}

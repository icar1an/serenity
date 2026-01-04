import Config from "../config";
import * as CompileConfig from "../../config.json";
import { isSafari } from "../../maze-utils/src/config";
import { isFirefoxOrSafari } from "../../maze-utils/src";

export function showDonationLink(): boolean {
    return navigator.vendor !== "Apple Computer, Inc." && Config.config.showDonationLink;
}

export function getExtensionIdsToImportFrom(): string[] {
    if (isSafari()) {
        return CompileConfig.extensionImportList.safari;
    } else if (isFirefoxOrSafari()) {
        return CompileConfig.extensionImportList.firefox;
    } else {
        return CompileConfig.extensionImportList.chromium;
    }
}
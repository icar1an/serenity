
import Config, { generateDebugDetails } from "./config";
import * as invidiousList from "../ci/invidiouslist.json";

// Make the config public for debugging purposes
(window as any).SB = Config;

import Utils from "./utils";
import { showDonationLink } from "./utils/configUtils";
import { localizeHtmlPage } from "../maze-utils/src/setup";




const utils = new Utils();
let embed = false;

if (document.readyState === "complete") {
    init();
} else {
    document.addEventListener("DOMContentLoaded", init);
}

async function init() {
    localizeHtmlPage();

    // selected tab
    if (location.hash != "") {
        const substr = location.hash.slice(1);
        let menuItem = document.querySelector(`[data-for='${substr}']`);
        if (menuItem == null)
            menuItem = document.querySelector(`[data-for='general']`);
        if (menuItem) menuItem.classList.add("selected");
    } else {
        const generalTab = document.querySelector(`[data-for='general']`);
        if (generalTab) generalTab.classList.add("selected");
    }

    const versionEl = document.getElementById("version");
    if (versionEl) versionEl.innerText = "v. " + chrome.runtime.getManifest().version;

    // Remove header if needed
    if (window.location.hash === "#embed") {
        embed = true;
        for (const element of document.getElementsByClassName("titleBar")) {
            element.classList.add("hidden");
        }

        const optionsEl = document.getElementById("options");
        if (optionsEl) optionsEl.classList.add("embed");
        createStickyHeader();
    }

    if (!Config.configSyncListeners.includes(optionsConfigUpdateListener)) {
        Config.configSyncListeners.push(optionsConfigUpdateListener);
    }

    await utils.wait(() => Config.config !== null);

    if (!Config.config.darkMode) {
        document.documentElement.setAttribute("data-theme", "light");
    }

    if (Config.config.prideTheme) {
        document.documentElement.setAttribute("data-theme", "pride");
        const logo = document.getElementById("title-bar-logo") as HTMLImageElement;
        if (logo) logo.src = "../icons/sb-pride.png";
    }

    const donate = document.getElementById("sbDonate");
    if (donate) {
        donate.addEventListener("click", () => Config.config.donateClicked = Config.config.donateClicked + 1);
        if (!showDonationLink()) {
            donate.classList.add("hidden");
        }
    }

    // Set all of the toggle options to the correct option
    const optionsContainer = document.getElementById("options");
    const optionsElements = optionsContainer.querySelectorAll("*");

    // Build lookup map to avoid O(n²) querySelector calls inside the loop
    const dataSyncMap = new Map<string, Element>();
    for (const el of optionsElements) {
        const syncAttr = el.getAttribute("data-sync");
        if (syncAttr) {
            dataSyncMap.set(syncAttr, el);
        }
    }

    for (let i = 0; i < optionsElements.length; i++) {
        const dependentOnName = optionsElements[i].getAttribute("data-dependent-on");
        const dependentOn = dependentOnName ? dataSyncMap.get(dependentOnName) : null;
        let isDependentOnReversed = false;
        if (dependentOn)
            isDependentOnReversed = dependentOn.getAttribute("data-toggle-type") === "reverse" || optionsElements[i].getAttribute("data-dependent-on-inverted") === "true";

        if (await shouldHideOption(optionsElements[i]) || (dependentOn && (isDependentOnReversed ? Config.config[dependentOnName] : !Config.config[dependentOnName]))) {
            optionsElements[i].classList.add("hidden", "hiding");
            if (!dependentOn) {
                if (optionsElements[i].getAttribute("data-no-safari") === "true" && optionsElements[i].id === "support-invidious") {
                    // Put message about being disabled on safari
                    const infoBox = document.createElement("div");
                    infoBox.innerText = chrome.i18n.getMessage("invidiousDisabledSafari");

                    const link = document.createElement("a");
                    link.style.display = "block";
                    const url = "https://bugs.webkit.org/show_bug.cgi?id=290508";
                    link.href = url;
                    link.innerText = url;

                    infoBox.appendChild(link);

                    optionsElements[i].parentElement.insertBefore(infoBox, optionsElements[i].nextSibling);
                }

                continue;
            }
        }

        const option = optionsElements[i].getAttribute("data-sync");

        switch (optionsElements[i].getAttribute("data-type")) {
            case "toggle": {
                const optionResult = Config.config[option];

                const checkbox = optionsElements[i].querySelector("input");
                const reverse = optionsElements[i].getAttribute("data-toggle-type") === "reverse";

                const confirmMessage = optionsElements[i].getAttribute("data-confirm-message");
                const confirmOnTrue = optionsElements[i].getAttribute("data-confirm-on") !== "false";

                if (optionResult != undefined)
                    checkbox.checked = reverse ? !optionResult : optionResult;

                // See if anything extra should be run first time
                switch (option) {
                    case "supportInvidious":
                        invidiousInit(checkbox, option);
                        break;
                }

                // Add click listener
                checkbox.addEventListener("click", async () => {
                    // Confirm if required
                    if (confirmMessage && ((confirmOnTrue && checkbox.checked) || (!confirmOnTrue && !checkbox.checked))
                        && !confirm(chrome.i18n.getMessage(confirmMessage))) {
                        checkbox.checked = !checkbox.checked;
                        return;
                    }

                    Config.config[option] = reverse ? !checkbox.checked : checkbox.checked;

                    // See if anything extra must be run
                    switch (option) {
                        case "supportInvidious":
                            invidiousOnClick(checkbox, option);
                            break;
                        case "showDonationLink":
                            if (document.getElementById("sbDonate")) {
                                if (checkbox.checked)
                                    document.getElementById("sbDonate").classList.add("hidden");
                                else
                                    document.getElementById("sbDonate").classList.remove("hidden");
                            }
                            break;
                        case "darkMode":
                            if (checkbox.checked) {
                                document.documentElement.setAttribute("data-theme", "dark");
                            } else {
                                document.documentElement.setAttribute("data-theme", "light");
                            }
                            break;
                        case "prideTheme":
                            if (checkbox.checked) {
                                document.documentElement.setAttribute("data-theme", "pride");
                            } else {
                                if (Config.config.darkMode) {
                                    document.documentElement.setAttribute("data-theme", "dark");
                                } else {
                                    document.documentElement.setAttribute("data-theme", "light");
                                }
                            }
                            break;
                    }

                    // If other options depend on this, hide/show them
                    const dependents = optionsContainer.querySelectorAll(`[data-dependent-on='${option}']`);
                    for (let j = 0; j < dependents.length; j++) {
                        const disableWhenChecked = dependents[j].getAttribute("data-dependent-on-inverted") === "true";
                        if (!await shouldHideOption(dependents[j]) && (!disableWhenChecked && checkbox.checked || disableWhenChecked && !checkbox.checked)) {
                            dependents[j].classList.remove("hidden");
                            setTimeout(() => dependents[j].classList.remove("hiding"), 1);
                        } else {
                            dependents[j].classList.add("hiding");
                            setTimeout(() => dependents[j].classList.add("hidden"), 400);
                        }
                    }
                });
                break;
            }
            case "text-change": {
                const textChangeInput = <HTMLInputElement>optionsElements[i].querySelector(".option-text-box");
                const textChangeSetButton = <HTMLElement>optionsElements[i].querySelector(".text-change-set");

                textChangeInput.value = Config.config[option];

                textChangeSetButton.addEventListener("click", async () => {
                    Config.config[option] = textChangeInput.value;
                });

                const textChangeResetButton = <HTMLElement>optionsElements[i].querySelector(".text-change-reset");
                textChangeResetButton.addEventListener("click", () => {
                    if (!confirm(chrome.i18n.getMessage("areYouSureReset"))) return;
                    Config.config[option] = Config.syncDefaults[option];
                    textChangeInput.value = Config.config[option];
                });

                break;
            }
            case "private-text-change": {
                const button = optionsElements[i].querySelector(".trigger-button");
                button.addEventListener("click", () => activatePrivateTextChange(<HTMLElement>optionsElements[i]));

                const privateTextChangeOption = optionsElements[i].getAttribute("data-sync");
                switch (privateTextChangeOption) {
                    case "invidiousInstances":
                        invidiousInstanceAddInit(<HTMLElement>optionsElements[i], privateTextChangeOption);
                }
                break;
            }
            case "button-press": {
                const actionButton = optionsElements[i].querySelector(".trigger-button");
                const confirmMessage = optionsElements[i].getAttribute("data-confirm-message");

                actionButton.addEventListener("click", () => {
                    if (confirmMessage !== null && !confirm(chrome.i18n.getMessage(confirmMessage))) {
                        return;
                    }
                    switch (optionsElements[i].getAttribute("data-sync")) {
                        case "copyDebugInformation":
                            copyDebugOutputToClipboard();
                            break;
                        case "resetToDefault":
                            Config.resetToDefault();
                            setTimeout(() => window.location.reload(), 200);
                            break;
                    }
                });
                break;
            }
            case "display": {
                updateDisplayElement(<HTMLElement>optionsElements[i])
                break;
            }
        }
    }

    // Tab interaction
    const tabElements = document.getElementsByClassName("tab-heading");
    for (let i = 0; i < tabElements.length; i++) {
        const tabFor = tabElements[i].getAttribute("data-for");

        if (tabElements[i].classList.contains("selected")) {
            const el = document.getElementById(tabFor);
            if (el) el.classList.remove("hidden");
        }

        tabElements[i].addEventListener("click", () => {
            if (!embed) location.hash = tabFor;

            createStickyHeader();

            document.querySelectorAll(".tab-heading").forEach(element => { element.classList.remove("selected"); });
            optionsContainer.querySelectorAll(".option-group").forEach(element => { element.classList.add("hidden"); });

            tabElements[i].classList.add("selected");
            const el = document.getElementById(tabFor);
            if (el) el.classList.remove("hidden");
        });
    }

    window.addEventListener("scroll", () => createStickyHeader());
    optionsContainer.classList.add("animated");
}

function createStickyHeader() {
    const container = document.getElementById("options-container");
    const options = document.getElementById("options");
    if (!container || !options) return;

    if (!embed && window.pageYOffset > 90 && (window.innerHeight <= 770 || window.innerWidth <= 1200)) {
        if (!container.classList.contains("sticky")) {
            options.style.marginTop = options.offsetTop.toString() + "px";
            container.classList.add("sticky");
        }
    } else {
        options.style.marginTop = "unset";
        container.classList.remove("sticky");
    }
}

async function shouldHideOption(element: Element): Promise<boolean> {
    return (element.getAttribute("data-private-only") === "true" && !(await isIncognitoAllowed()))
        || (element.getAttribute("data-no-safari") === "true" && navigator.vendor === "Apple Computer, Inc.");
}

function optionsConfigUpdateListener() {
    const optionsContainer = document.getElementById("options");
    const optionsElements = optionsContainer.querySelectorAll("*");
    for (let i = 0; i < optionsElements.length; i++) {
        switch (optionsElements[i].getAttribute("data-type")) {
            case "display":
                updateDisplayElement(<HTMLElement>optionsElements[i])
                break;
        }
    }
}

function updateDisplayElement(element: HTMLElement) {
    const displayOption = element.getAttribute("data-sync")
    const displayText = Config.config[displayOption];
    element.innerText = displayText;
    switch (displayOption) {
        case "invidiousInstances": {
            element.innerText = displayText.join(', ');
            let allEquals = displayText.length == invidiousList.length;
            for (let i = 0; i < invidiousList.length && allEquals; i++) {
                if (displayText[i] != invidiousList[i])
                    allEquals = false;
            }
            if (!allEquals) {
                const resetButton = element.parentElement.querySelector(".invidious-instance-reset");
                resetButton.classList.remove("hidden");
            }
            break;
        }
    }
}

function invidiousInstanceAddInit(element: HTMLElement, option: string) {
    const textBox = <HTMLInputElement>element.querySelector(".option-text-box");
    const button = element.querySelector(".trigger-button");
    const setButton = element.querySelector(".text-change-set");
    const cancelButton = element.querySelector(".text-change-reset");
    const resetButton = element.querySelector(".invidious-instance-reset");

    setButton.addEventListener("click", async function () {
        if (textBox.value == "" || textBox.value.includes("/") || textBox.value.includes("http")) {
            alert(chrome.i18n.getMessage("addInvidiousInstanceError"));
        } else {
            let instanceList = Config.config[option];
            if (!instanceList) instanceList = [];
            let domain = textBox.value.trim().toLowerCase();
            if (domain.includes(":")) {
                domain = domain.split(":")[0];
            }
            instanceList.push(domain);
            Config.config[option] = instanceList;
            const checkbox = <HTMLInputElement>document.querySelector("#support-invidious input");
            checkbox.checked = true;
            invidiousOnClick(checkbox, "supportInvidious");
            resetButton.classList.remove("hidden");
            textBox.value = "";
            element.querySelector(".option-hidden-section").classList.add("hidden");
            button.classList.remove("disabled");
        }
    });

    cancelButton.addEventListener("click", async function () {
        textBox.value = "";
        element.querySelector(".option-hidden-section").classList.add("hidden");
        button.classList.remove("disabled");
    });

    resetButton.addEventListener("click", function () {
        if (confirm(chrome.i18n.getMessage("resetInvidiousInstanceAlert"))) {
            Config.config[option] = invidiousList;
            resetButton.classList.add("hidden");
        }
    });
}

function invidiousInit(checkbox: HTMLInputElement, option: string) {
    utils.containsInvidiousPermission().then((result) => {
        if (result != checkbox.checked) {
            Config.config[option] = result;
            checkbox.checked = result;
        }
    });
}

async function invidiousOnClick(checkbox: HTMLInputElement, option: string): Promise<void> {
    const enabled = await utils.applyInvidiousPermissions(checkbox.checked, option);
    checkbox.checked = enabled;
}

function activatePrivateTextChange(element: HTMLElement) {
    const button = element.querySelector(".trigger-button");
    if (button.classList.contains("disabled")) return;
    button.classList.add("disabled");

    const textBox = <HTMLInputElement>element.querySelector(".option-text-box");
    const option = element.getAttribute("data-sync");

    // See if anything extra must be done
    switch (option) {
        case "invidiousInstances":
            element.querySelector(".option-hidden-section").classList.remove("hidden");
            return;
    }

    const result = Config.config[option];


    textBox.value = result;

    const setButton = element.querySelector(".text-change-set");
    setButton.addEventListener("click", async () => {
        const confirmMessage = element.getAttribute("data-confirm-message");
        if (confirmMessage === null || confirm(chrome.i18n.getMessage(confirmMessage))) {
            Config.config[option] = textBox.value;
        }
    });

    // Verify userID etc (stripped specific complex logic for now unless critical)


    element.querySelector(".option-hidden-section").classList.remove("hidden");
}



function copyDebugOutputToClipboard() {
    navigator.clipboard.writeText(generateDebugDetails())
        .then(() => {
            alert(chrome.i18n.getMessage("copyDebugInformationComplete"));
        })
        .catch(() => {
            alert(chrome.i18n.getMessage("copyDebugInformationFailed"));
        });
}

function isIncognitoAllowed(): Promise<boolean> {
    return new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve));
}

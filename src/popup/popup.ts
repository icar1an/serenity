/**
 * Serenity Popup - Based on Clarity's modern UI
 * Provides a simple toggle, blocked count, and labeler access
 */

let enabled = false; // Start in OFF state (pale foggy)

document.addEventListener('DOMContentLoaded', () => {

    function detectColorScheme() {
        chrome.storage.local.get("storageData", (result) => {
            let uiTheme = "light";
            const storageTheme = result.storageData?.uiTheme;

            if (storageTheme) {
                uiTheme = storageTheme;
            } else if (!window.matchMedia) {
                uiTheme = "light";
            } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
                uiTheme = "dark";
            }

            document.documentElement.setAttribute("data-theme", uiTheme);
        });
    }

    detectColorScheme();

    const checkbox = document.getElementById("toggle-extension") as HTMLInputElement;
    const circlePlaceholder = document.getElementById("circle-placeholder");
    const blockedCount = document.getElementById("blocked-count");

    if (!checkbox || !circlePlaceholder || !blockedCount) {
        console.error('[Serenity Popup] Required elements not found');
        return;
    }

    // Update UI based on enabled state (without animation)
    function updateUI(isEnabled: boolean, animate = false) {
        enabled = isEnabled;
        checkbox.checked = isEnabled;

        // Remove all transition classes first
        circlePlaceholder!.classList.remove("active", "turning-on", "turning-off");

        if (isEnabled) {
            // ON State = Bright blue, clear, filled shield
            if (animate) {
                // Start ON transition
                // Sequence: Fog fade (200ms) → Ripple (200ms) → Liquid fill (250ms starting at 200ms)
                circlePlaceholder!.classList.add("turning-on");
                setTimeout(() => {
                    circlePlaceholder!.classList.remove("turning-on");
                    circlePlaceholder!.classList.add("active");
                }, 450); // Total: 200ms fog + 250ms liquid fill = 450ms
            } else {
                circlePlaceholder!.classList.add("active");
            }
        } else {
            // OFF State = Pale foggy, dim shield
            if (animate) {
                // Start OFF transition
                circlePlaceholder!.classList.add("turning-off");
                setTimeout(() => {
                    circlePlaceholder!.classList.remove("turning-off");
                }, 500); // Wait for all animations (300ms liquid + 300ms fog)
            }
        }
    }

    // Load blocked count
    function loadBlockedCount() {
        chrome.storage.local.get("blockedCount", (result) => {
            const count = result.blockedCount || 0;
            blockedCount!.textContent = count.toLocaleString();
        });
    }

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes) => {
        if ('enabled' in changes) {
            // Don't animate on external changes (only on user clicks)
            updateUI(!!changes.enabled.newValue, false);
        }
        if ('blockedCount' in changes) {
            console.log('[Popup] blockedCount changed', changes.blockedCount);
            blockedCount!.textContent = (changes.blockedCount.newValue || 0).toLocaleString();
        }
    });

    // Restore the switch state from storage - map disableSkipping to enabled
    chrome.storage.sync.get(["disableSkipping"], (result) => {
        // In Serenity/Serenity, disableSkipping=true means OFF, we want inverted
        const isEnabled = !result.disableSkipping;
        updateUI(isEnabled, false);
    });

    // Load initial blocked count
    loadBlockedCount();

    // Toggle function
    function toggleExtension() {
        const newState = !enabled;
        console.log({ enabled: newState });

        // Update UI with animation
        updateUI(newState, true);

        // Save to storage - invert for Serenity's config (disableSkipping = !enabled)
        chrome.storage.sync.set({ disableSkipping: !newState });

        // Also save to local for compatibility
        chrome.storage.local.set({ enabled: newState });

        // Reload page to apply the new state
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.reload(tabs[0].id);
            }
        });
    }

    // Listen for changes to the checkbox (if changed programmatically)
    checkbox.addEventListener("change", (event) => {
        if (event.target instanceof HTMLInputElement) {
            const isChecked = !!event.target.checked;
            if (isChecked !== enabled) {
                toggleExtension();
            }
        }
    });

    // Make circle placeholder clickable
    circlePlaceholder.addEventListener("click", () => {
        toggleExtension();
    });

    // Review link - opens Chrome Web Store
    const reviewLink = document.getElementById("review-link");
    if (reviewLink) {
        reviewLink.addEventListener("click", (e) => {
            e.preventDefault();
            // Get extension ID and open Chrome Web Store review page
            chrome.tabs.create({
                url: `https://chrome.google.com/webstore/detail/${chrome.runtime.id}/reviews`
            });
        });
    }

    // Ko-fi link - already has href, but we can add target handling if needed
    const kofiLink = document.getElementById("kofi-link");
    if (kofiLink) {
        kofiLink.addEventListener("click", () => {
            // Allow default behavior (opens in new tab via target="_blank")
        });
    }

    // Labeler button - opens the manual labeler page
    const labelerButton = document.getElementById("labeler-button");
    if (labelerButton) {
        labelerButton.addEventListener("click", () => {
            const labelerUrl = chrome.runtime.getURL("pages/labeler/labeler.html");
            chrome.tabs.create({ url: labelerUrl });
        });
    }
});

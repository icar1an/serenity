/**
 * Serenity Configuration
 * Handles loading configuration from environment variables (injected at build time)
 * and initializing it in Chrome storage.
 */

// Define interface for global process.env (injected by webpack)
declare const process: {
    env: {
        SUPABASE_URL?: string;
        SUPABASE_ANON_KEY?: string;
        SUPABASE_SERVICE_ROLE_KEY?: string;
        SUPABASE_FUNCTION_URL?: string;
        MANUAL_LABELER_TOKEN?: string;
        [key: string]: string | undefined;
    };
};

export interface SerenityConfig {
    supabase_url: string;
    supabase_anon_key: string;
    manual_labeler_token: string;
}

/**
 * Initializes Serenity configuration in Chrome storage
 * Should be called by background script on install/startup
 */
export function initializeSerenityConfig(): Promise<void> {
    return new Promise((resolve) => {
        const config = {
            supabase_url: process.env.SUPABASE_URL || '',
            supabase_anon_key: process.env.SUPABASE_ANON_KEY || '',
            manual_labeler_token: process.env.MANUAL_LABELER_TOKEN || '',
        };

        // Also include function URL if available (Clarity style fallback)
        if (process.env.SUPABASE_FUNCTION_URL) {
            // @ts-ignore
            config.supabase_function_url = process.env.SUPABASE_FUNCTION_URL;
        }

        console.log('[Serenity] Initializing config from build environment');

        chrome.storage.local.set(config, () => {
            if (chrome.runtime.lastError) {
                console.error('[Serenity] Failed to save config:', chrome.runtime.lastError);
            } else {
                console.log('[Serenity] Config saved to storage');
            }
            resolve();
        });
    });
}

/**
 * Gets the current configuration from storage
 */
export function getSerenityConfig(): Promise<SerenityConfig> {
    return new Promise((resolve) => {
        chrome.storage.local.get([
            'supabase_url',
            'supabase_anon_key',
            'manual_labeler_token'
        ], (result) => {
            resolve(result as SerenityConfig);
        });
    });
}

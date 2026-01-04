
export interface Registration {
    message: string;
    id: string;
    allFrames: boolean;
    js: string[];
    css: string[];
    matches: string[];
}

export interface BackgroundScriptContainer {
    registerFirefoxContentScript: (opts: Registration) => void;
    unregisterFirefoxContentScript: (id: string) => void;
}

export interface VideoInfo {
    responseContext: {
        serviceTrackingParams: Array<{ service: string; params: Array<{ key: string; value: string }> }>;
        webResponseContextExtensionData: {
            hasDecorated: boolean;
        };
    };
    playabilityStatus: {
        status: string;
        playableInEmbed: boolean;
        miniplayer: {
            miniplayerRenderer: {
                playbackMode: string;
            };
        };
    };
    streamingData: unknown;
    playbackTracking: unknown;
    videoDetails: {
        videoId: string;
        title: string;
        lengthSeconds: string;
        keywords: string[];
        channelId: string;
        isOwnerViewing: boolean;
        shortDescription: string;
        isCrawlable: boolean;
        thumbnail: {
            thumbnails: Array<{ url: string; width: number; height: number }>;
        };
        averageRating: number;
        allowRatings: boolean;
        viewCount: string;
        author: string;
        isPrivate: boolean;
        isUnpluggedCorpus: boolean;
        isLiveContent: boolean;
    };
    playerConfig: unknown;
    storyboards: unknown;
    microformat: {
        playerMicroformatRenderer: {
            thumbnail: {
                thumbnails: Array<{ url: string; width: number; height: number }>;
            };
            embed: {
                iframeUrl: string;
                flashUrl: string;
                width: number;
                height: number;
                flashSecureUrl: string;
            };
            title: {
                simpleText: string;
            };
            description: {
                simpleText: string;
            };
            lengthSeconds: string;
            ownerProfileUrl: string;
            externalChannelId: string;
            availableCountries: string[];
            isUnlisted: boolean;
            hasYpcMetadata: boolean;
            viewCount: string; /* Category is removed from here if it was skip-related, but YouTube category might be useful */
            publishDate: string;
            ownerChannelName: string;
            uploadDate: string;
        };
    };
    trackingParams: string;
    attestation: unknown;
    messages: unknown;
}

export type VideoID = string;

export enum ChannelIDStatus {
    Fetching,
    Found,
    Failed
}

export interface ChannelIDInfo {
    id: string;
    author?: string;
    status: ChannelIDStatus;
}
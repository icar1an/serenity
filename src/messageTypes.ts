//
// Message and Response Types
//

import { VideoID } from "./types";

interface BaseMessage {
    from?: string;
}

interface DefaultMessage {
    message:
    "update"
    | "getChannelID"
    | "closePopup"
    | "getLogs";
}

interface IsInfoFoundMessage {
    message: "isInfoFound";
    updating?: boolean;
}

interface CopyToClipboardMessage {
    message: "copyToClipboard";
    text: string;
}

interface KeyDownMessage {
    message: "keydown";
    key: string;
    keyCode: number;
    code: string;
    which: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
}

// Serenity: Message for getting video info for labeler
interface SerenityVideoInfoMessage {
    message: "serenity_get_video_info";
}

export type Message = BaseMessage & (DefaultMessage | IsInfoFoundMessage | CopyToClipboardMessage | KeyDownMessage | SerenityVideoInfoMessage);

export interface IsInfoFoundMessageResponse {
    found: boolean;
    status: number | string | Error;
    time: number;
    onMobileYouTube: boolean;
    videoID: VideoID;
    channelID: string;
    channelAuthor: string;
}

interface GetVideoIdResponse {
    videoID: string;
}

export interface GetChannelIDResponse {
    channelID: string;
    isYTTV: boolean;
}

export interface IsChannelWhitelistedResponse {
    value: boolean;
}

// Serenity: Response for video info request
export interface SerenityVideoInfoResponse {
    videoId: VideoID | null;
    channelId: string | null;
    handle?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    thumbnail?: string | null;
}

export interface LogResponse {
    debug: string[];
    warn: string[];
}

export interface TimeUpdateMessage {
    message: "time";
    time: number;
}

export interface InfoUpdatedMessage {
    message: "infoUpdated";
    videoID: VideoID;
    channelID: string;
    channelAuthor: string;
}

export interface VideoChangedPopupMessage {
    message: "videoChanged";
    videoID: string;
    channelID: string;
    channelAuthor: string;
}

export type PopupMessage = TimeUpdateMessage | InfoUpdatedMessage | VideoChangedPopupMessage;

export type MessageResponse =
    IsInfoFoundMessageResponse
    | GetVideoIdResponse
    | GetChannelIDResponse
    | IsChannelWhitelistedResponse
    | Record<string, never> // empty object response {}
    | LogResponse
    | SerenityVideoInfoResponse;
